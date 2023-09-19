const SSLCommerzPayment = require("sslcommerz").SslCommerzPayment;
const dotenv = require('dotenv');
const airPool = require('../config/airDB');
const accountPool = require('../config/accountDB');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const nodemailer = require('nodemailer');
const { initializeApp } = require('firebase/app');
const { getStorage, ref, uploadBytes, getDownloadURL } = require('firebase/storage');
const fs = require('fs').promises;
const path = require('path');

dotenv.config();

const firebaseConfig = {
    apiKey: process.env.FIREBASEAPIKEY,
    authDomain: process.env.FIREBASEAUTHDOMAIN,
    projectId: process.env.FIREBASEPROJECTID,
    storageBucket: process.env.FIREBASESTORAGEBUCKET,
    messagingSenderId: process.env.FIREBASEMESSAGINGSENDERID,
    appId: process.env.FIREBASEAPPID,
    measurementId: process.env.FIREBASEMEASUREMENTID
};

const app = initializeApp(firebaseConfig);

const storage = getStorage(app);

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'triptix.sfz@gmail.com',
        pass: 'geviigtztnzsfnbm', // Use an "App Password" if you have 2-Step Verification enabled
    },
});

const store_id = process.env.STOREID
const store_passwd = process.env.STOREPASSWORD
const is_live = false //true for live, false for sandbox

const mainUrl = process.env.MAINURL

//sslcommerz success
const paymentSuccessAir = async (req, res) => {

    airPool.query('BEGIN');

    const data = req.body;
    const { airScheduleIds, ticketIds } = req.body;
    const ssl = new SSLCommerzPayment(store_id, store_passwd, is_live)
    const validation = ssl.validate(data);
    validation.then(validation => {
        console.log('Validation success');
        console.log(validation);
    }).catch(error => {
        console.log(error);
    });

    const transactionId = data.tran_id;
    const paymentMedium = data.card_issuer;
    const airScheduleIdArray = airScheduleIds.split('_');
    const ticketIdArray = ticketIds.split('_');
    console.log(transactionId, paymentMedium, airScheduleIdArray, ticketIdArray)
    try {
        for (let i = 0; i < ticketIdArray.length - 1; i++) {
            const ticketId = ticketIdArray[i];
            const airScheduleId = airScheduleIdArray[i];

            // Generate ticket
            const getTicketInfoQuery = {
                text: `SELECT * FROM ticket_info WHERE ticket_id = $1`,
                values: [ticketId]
            }
            const ticketInfo = await airPool.query(getTicketInfoQuery);
            const ticketInfoData = ticketInfo.rows[0];

            const totalFare = ticketInfoData.total_fare;
            const passengerInfo = ticketInfoData.passenger_info;
            const date = ticketInfoData.date;
            const userId = ticketInfoData.user_id;
            const source = ticketInfoData.source;
            const destination = ticketInfoData.destination;
            const classId = ticketInfoData.class_id;

            // Get source and destination name
            const getSourceNameQuery = {
                text: `SELECT CONCAT (location_name || ' - ' || airport_name) AS location_name FROM location_info WHERE location_id = $1`,
                values: [source]
            }
            const sourceNameResult = await airPool.query(getSourceNameQuery);
            const sourceNameData = sourceNameResult.rows[0];
            const sourceName = sourceNameData.location_name;

            const getDestinationNameQuery = {
                text: `SELECT CONCAT (location_name || ' - ' || airport_name) AS location_name FROM location_info WHERE location_id = $1`,
                values: [destination]
            }
            const destinationNameResult = await airPool.query(getDestinationNameQuery);
            const destinationNameData = destinationNameResult.rows[0];
            const destinationName = destinationNameData.location_name;


            // Get user email from user_info
            const getUserEmailQuery = {
                text: `SELECT email FROM user_info WHERE user_id = $1`,
                values: [userId]
            }
            const userEmailQueryResult = await accountPool.query(getUserEmailQuery);
            const userEmailData = userEmailQueryResult.rows[0];
            const userEmail = userEmailData.email;

            const getAirScheduleInfoQuery = {
                text: `SELECT * FROM air_schedule_info WHERE air_schedule_id = $1`,
                values: [airScheduleId]
            }
            const airScheduleInfo = await airPool.query(getAirScheduleInfoQuery);
            const airScheduleInfoData = airScheduleInfo.rows[0];
            const airId = airScheduleInfoData.air_company_id;
            const departureDate = airScheduleInfoData.schedule_date;
            const departureTime = airScheduleInfoData.departure_time;
            const uniqueAirId = airScheduleInfoData.unique_air_company_id;
            const airFare = totalFare / passengerInfo.length;

            const getAirInfoQuery = {
                text: `SELECT * FROM air_services WHERE air_company_id = $1`,
                values: [airId]
            }
            const airInfo = await airPool.query(getAirInfoQuery);
            const airInfoData = airInfo.rows[0];

            const airServiceName = airInfoData.air_company_name;

            // Get class name and brand name
            const airClassDetailsQuery = {
                text: `SELECT class_name 
                FROM class_info 
                WHERE class_id = $1`,
                values: [classId]
            }
            const airClassDetails = await airPool.query(airClassDetailsQuery);
            const airClassDetailsData = airClassDetails.rows[0];
            const className = airClassDetailsData.class_name;


            const getPassengerInfoQuery = {
                text: `SELECT * FROM passenger_info WHERE passenger_id = ANY($1)`,
                values: [passengerInfo]
            }
            const passengerInfoData = await accountPool.query(getPassengerInfoQuery);
            const passengerInfoArray = passengerInfoData.rows;

            let passengerData = [];

            for (let j = 0; j < passengerInfoArray.length; j++) {
                let passenger = [];
                const passengerId = passengerInfoArray[j].passenger_id;
                passenger.push(passengerInfoArray[j].passenger_name);
                passenger.push(passengerInfoArray[j].passenger_age);
                passenger.push(passengerInfoArray[j].passenger_gender);
                passenger.push(passengerInfoArray[j].passenger_mobile);

                const getSeatInfoQuery = {
                    text: `SELECT air_seat_details.seat_name, air_schedule_seat_info.air_seat_id  
                    FROM air_schedule_seat_info 
                    INNER JOIN air_seat_details ON air_schedule_seat_info.air_seat_id = air_seat_details.air_seat_id 
                    WHERE air_schedule_seat_info.ticket_id = $1 
                    AND air_schedule_seat_info.passenger_id = $2`,
                    values: [ticketId, passengerId]
                }
                const seatInfo = await airPool.query(getSeatInfoQuery);
                const seatInfoData = seatInfo.rows[0];
                passenger.push(seatInfoData.seat_name);
                passenger.push(airFare);

                passengerData.push(passenger);
            }

            // Create ticket pdf
            const pdfDoc = await PDFDocument.create();

            // Add a page to the document
            const page = pdfDoc.addPage([600, 800]);

            const logoFilePath = path.join(__dirname, 'TripTixLogoBlack.png'); // Replace 'company_logo.png' with your logo file name
            const logoImageBytes = await fs.readFile(logoFilePath);

            const logoImage = await pdfDoc.embedPng(logoImageBytes);

            // Draw the company logo
            const logoDims = logoImage.scale(0.2); // Adjust the scale as needed
            page.drawImage(logoImage, {
                x: 50,
                y: page.getHeight() - logoDims.height - 50,
                width: logoDims.width,
                height: logoDims.height,
            });

            // Add a title
            page.drawText('TripTix', {
                x: 50,
                y: page.getHeight() - logoDims.height - 100,
                size: 30,
                font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
                color: rgb(0.1, 0.1, 0.1), // Black 0.1, 0.1, 0.1
            });

            // Add Ticket ID, journey information, and payment details
            let startY = page.getHeight() - logoDims.height - 150;
            const lineSpacing = 25;

            const textLines = [
                `Journey Date:`,
                `${departureDate}`,
                `Journey Time:`,
                `${departureTime}`,
                `Starting Location:`,
                `${sourceName}`,
                `Destination Location:`,
                `${destinationName}`,
            ];

            let initalStart = startY;

            page.drawText('Ticket ID: ' + ticketId, {
                x: 50,
                y: startY,
                size: 15,
                font: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
                color: rgb(0.2, 0.2, 0.2),
            });

            startY -= lineSpacing;

            let k = 0;
            for (const line of textLines) {
                page.drawText(line, {
                    x: 50,
                    y: startY,
                    size: 9,
                    font: await pdfDoc.embedFont(k % 2 === 0 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica),
                    color: rgb(0, 0, 0),
                });
                k++;
                startY -= 15;
            }

            startY = initalStart - lineSpacing;

            const textLines2 = [
                `Company Name:`,
                `${airServiceName}`,
                `Class:`,
                `${className}`,
                `Air ID`,
                `${uniqueAirId}`,
            ];

            k = 0;
            for (const line2 of textLines2) {
                page.drawText(line2, {
                    x: page.getWidth() - 150,
                    y: startY,
                    size: 10,
                    font: await pdfDoc.embedFont(k % 2 === 0 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica),
                    color: rgb(0, 0, 0),
                });
                k += 1
                startY -= 15;
            }

            // Define colors
            const tableHeaderBackgroundColor = rgb(217 / 255, 196 / 255, 177 / 255);
            const tableBorderColor = rgb(0.7, 0.7, 0.7);

            // Define the table layout
            const tableX = 50;
            const tableY = 400;
            const rowHeight = 30;
            const colWidths = [120, 50, 50, 100, 80, 80];

            // Define the table header
            const tableHeader = ['Name', 'Age', 'Gender', 'Phone', 'Seat', 'Fare'];

            // Draw the table header with background color and border
            let currentY = tableY;
            for (let j = 0; j < tableHeader.length; j++) {
                // Draw background color rectangle for the table header cell
                page.drawRectangle({
                    x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0),
                    y: currentY,
                    width: colWidths[j],
                    height: rowHeight,
                    color: tableHeaderBackgroundColor,
                    borderColor: rgb(0.7, 0.7, 0.7),
                    borderWidth: 1,
                });

                // Draw text for the table header cell
                page.drawText(tableHeader[j], {
                    x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0) + 5, // Adjust the padding
                    y: currentY + rowHeight / 2 - 6, // Center vertically
                    size: 12,
                    font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                    color: rgb(0, 0, 0),
                });
            }
            currentY -= rowHeight;

            // Draw the table rows with borders
            for (const rowData of passengerData) {
                for (let j = 0; j < rowData.length; j++) {
                    // Draw border rectangle for the table cell
                    page.drawRectangle({
                        x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0),
                        y: currentY,
                        width: colWidths[j],
                        height: rowHeight,
                        borderColor: tableBorderColor,
                        borderWidth: 1,
                    });

                    // Draw text for the table cell
                    page.drawText(`${rowData[j]}`, {
                        x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0) + 5, // Adjust the padding
                        y: currentY + rowHeight / 2 - 6, // Center vertically
                        size: 10,
                        font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                        color: rgb(0, 0, 0),
                    });
                }
                currentY -= rowHeight;
            }

            // Add the total price
            ; // Implement this function
            page.drawText(`Total Fare: Tk ${totalFare}`, {
                x: 400,
                y: currentY - 10,
                size: 15,
                font: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
                color: rgb(0.1, 0.1, 0.1),
            });

            // Add a rectangle above the existing one
            const upperRectX = tableX;
            const upperRectY = currentY - 60; // Adjust the vertical position as needed
            const upperRectWidth = page.getWidth() - 2 * tableX;
            const upperRectHeight = 30; // Adjust the height as needed

            page.drawRectangle({
                x: upperRectX,
                y: upperRectY,
                width: upperRectWidth,
                height: upperRectHeight,
                borderColor: rgb(0, 0, 0), // Border color (black)
                borderWidth: 1,
            });

            const textX = upperRectX + 20; // Adjust the horizontal position of text

            page.drawText('Transaction ID:', {
                x: textX,
                y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
                color: rgb(0, 0, 0), // Text color (black)
            });

            page.drawText(transactionId, {
                x: textX + 100, // Adjust the horizontal position of text
                y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            page.drawText('Payment Method:', {
                x: textX + 250, // Adjust the horizontal position of text
                y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
                color: rgb(0, 0, 0), // Text color (black)
            });

            page.drawText(paymentMedium, {
                x: textX + 350, // Adjust the horizontal position of text
                y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            const rectX = upperRectX;
            const rectY = upperRectY - 100; // Adjust the vertical position as needed
            const rectWidth = page.getWidth() - 2 * tableX;
            const rectHeight = 100; // Adjust the height as needed

            page.drawRectangle({
                x: rectX,
                y: rectY,
                width: rectWidth,
                height: rectHeight,
                borderColor: rgb(0, 0, 0), // Border color (black)
                borderWidth: 1,
            });

            // Add the terms and conditions as bullet points inside the rectangle

            const term1 = 'How to use the PDF: This PDF serves as your valid ticket for transportation. Simply display it on your mobile device or print it out';
            const term12 = 'and present it to the transportation staff for scanning or verification.';

            const term2 = 'Do not share with others: Please keep this ticket for your personal use only. Sharing it with others may result in loss of access ';
            const term21 = 'to the transportation service.';

            const term3 = 'Lost ticket: If you happen to lose this PDF ticket, please contact our customer support immediately at triptix.sfz@gmail.com';
            const term32 = 'to report the loss and request assistance. We will do our best to assist you in resolving the issue promptly.';


            const bulletX = rectX + 20; // Adjust the horizontal position of bullet points
            let bulletY = rectY + rectHeight - 20; // Adjust the vertical position of bullet points

            page.drawText('•', {
                x: bulletX,
                y: bulletY,
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Bullet point color (black)
            });

            page.drawText(term1, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            bulletY -= 10; // Adjust the vertical spacing between bullet points

            page.drawText(term12, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            bulletY -= 20; // Adjust the vertical spacing between bullet points

            page.drawText('•', {
                x: bulletX,
                y: bulletY,
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Bullet point color (black)
            });

            page.drawText(term2, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            bulletY -= 10; // Adjust the vertical spacing between bullet points

            page.drawText(term21, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            bulletY -= 20; // Adjust the vertical spacing between bullet points

            page.drawText('•', {
                x: bulletX,
                y: bulletY,
                size: 10,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Bullet point color (black)
            });

            page.drawText(term3, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            bulletY -= 10; // Adjust the vertical spacing between bullet points

            page.drawText(term32, {
                x: bulletX + 20, // Adjust the horizontal position of text
                y: bulletY,
                size: 8,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0), // Text color (black)
            });

            // Serialize the PDF to a buffer
            const pdfBytes = await pdfDoc.save();
            const pdfBuffer = Buffer.from(pdfBytes.buffer);

            // Save ticket to firebase storage
            const mountainsRef = ref(storage, `${ticketId}.pdf`);
            await uploadBytes(mountainsRef, pdfBuffer);

            // Get ticket download url
            const downloadURL = await getDownloadURL(ref(storage, `${ticketId}.pdf`));
            console.log(downloadURL);

            const updateTicketInfoQuery = {
                text: `UPDATE ticket_info SET payment_medium = $1, payment_status = $2, transaction_id = $3, ticket_url = $4 WHERE ticket_id = $5`,
                values: [paymentMedium, 1, transactionId, downloadURL, ticketId]
            }
            await airPool.query(updateTicketInfoQuery);
            console.log('Ticket info updated to database');

            // Update air schedule info
            const updateAirScheduleQuery = {
                text: `UPDATE air_schedule_seat_info 
                SET booked_status = 2 
                WHERE air_schedule_id = $1 
                AND ticket_id = $2`,
                values: [airScheduleId, ticketId]
            }
            await airPool.query(updateAirScheduleQuery);
            console.log('Air schedule info updated to database');

            // Send ticket to user email
            const mailOptions = {
                from: 'triptix.sfz@gmail.com',
                to: userEmail,
                subject: `${ticketId} Ticket`,
                text: 'Here is your ticket. Enjoy your journey!',
                attachments: [
                    {
                        filename: `${ticketId}.pdf`,
                        path: `${downloadURL}`,
                        contentType: 'application/pdf'
                    }
                ]
            };
            await transporter.sendMail(mailOptions);
            console.log('Ticket sent to user email');

        }
        airPool.query('COMMIT');

        return res.status(200).json({
            status: 'success',
            message: 'Payment Success',
            data: req.body
        });
    } catch (err) {
        airPool.query('ROLLBACK');
        console.log(err);
        return res.status(500).json({
            status: 'fail',
            message: 'Database error',
            data: err
        });
    }
}

const paymentSuccessAirProfile = async (req, res) => {

    airPool.query('BEGIN');

    const data = req.body;
    const { airScheduleId, ticketId } = req.body;
    const ssl = new SSLCommerzPayment(store_id, store_passwd, is_live)
    const validation = ssl.validate(data);
    validation.then(validation => {
        console.log('Validation success');
        console.log(validation);
    }).catch(error => {
        console.log(error);
    });

    const transactionId = data.tran_id;
    const paymentMedium = data.card_issuer;

    console.log(transactionId, paymentMedium)
    try {
        // Generate ticket
        const getTicketInfoQuery = {
            text: `SELECT * FROM ticket_info WHERE ticket_id = $1`,
            values: [ticketId]
        }
        const ticketInfo = await airPool.query(getTicketInfoQuery);
        const ticketInfoData = ticketInfo.rows[0];

        const totalFare = ticketInfoData.total_fare;
        const passengerInfo = ticketInfoData.passenger_info;
        const date = ticketInfoData.date;
        const userId = ticketInfoData.user_id;
        const source = ticketInfoData.source;
        const destination = ticketInfoData.destination;
        const classId = ticketInfoData.class_id;

        // Get source and destination name
        const getSourceNameQuery = {
            text: `SELECT CONCAT (location_name || ' - ' || airport_name) AS location_name FROM location_info WHERE location_id = $1`,
            values: [source]
        }
        const sourceNameResult = await airPool.query(getSourceNameQuery);
        const sourceNameData = sourceNameResult.rows[0];
        const sourceName = sourceNameData.location_name;

        const getDestinationNameQuery = {
            text: `SELECT CONCAT (location_name || ' - ' || airport_name) AS location_name FROM location_info WHERE location_id = $1`,
            values: [destination]
        }
        const destinationNameResult = await airPool.query(getDestinationNameQuery);
        const destinationNameData = destinationNameResult.rows[0];
        const destinationName = destinationNameData.location_name;


        // Get user email from user_info
        const getUserEmailQuery = {
            text: `SELECT email FROM user_info WHERE user_id = $1`,
            values: [userId]
        }
        const userEmailQueryResult = await accountPool.query(getUserEmailQuery);
        const userEmailData = userEmailQueryResult.rows[0];
        const userEmail = userEmailData.email;

        const getAirScheduleInfoQuery = {
            text: `SELECT * FROM air_schedule_info WHERE air_schedule_id = $1`,
            values: [airScheduleId]
        }
        const airScheduleInfo = await airPool.query(getAirScheduleInfoQuery);
        const airScheduleInfoData = airScheduleInfo.rows[0];
        const airId = airScheduleInfoData.air_company_id;
        const departureDate = airScheduleInfoData.schedule_date;
        const departureTime = airScheduleInfoData.departure_time;
        const uniqueAirId = airScheduleInfoData.unique_air_company_id;
        const airFare = totalFare / passengerInfo.length;

        const getAirInfoQuery = {
            text: `SELECT * FROM air_services WHERE air_company_id = $1`,
            values: [airId]
        }
        const airInfo = await airPool.query(getAirInfoQuery);
        const airInfoData = airInfo.rows[0];

        const airServiceName = airInfoData.air_company_name;

        // Get class name and brand name
        const airClassDetailsQuery = {
            text: `SELECT class_name 
                FROM class_info 
                WHERE class_id = $1`,
            values: [classId]
        }
        const airClassDetails = await airPool.query(airClassDetailsQuery);
        const airClassDetailsData = airClassDetails.rows[0];
        const className = airClassDetailsData.class_name;


        const getPassengerInfoQuery = {
            text: `SELECT * FROM passenger_info WHERE passenger_id = ANY($1)`,
            values: [passengerInfo]
        }
        const passengerInfoData = await accountPool.query(getPassengerInfoQuery);
        const passengerInfoArray = passengerInfoData.rows;

        let passengerData = [];

        for (let j = 0; j < passengerInfoArray.length; j++) {
            let passenger = [];
            const passengerId = passengerInfoArray[j].passenger_id;
            passenger.push(passengerInfoArray[j].passenger_name);
            passenger.push(passengerInfoArray[j].passenger_age);
            passenger.push(passengerInfoArray[j].passenger_gender);
            passenger.push(passengerInfoArray[j].passenger_mobile);

            const getSeatInfoQuery = {
                text: `SELECT air_seat_details.seat_name, air_schedule_seat_info.air_seat_id  
                    FROM air_schedule_seat_info 
                    INNER JOIN air_seat_details ON air_schedule_seat_info.air_seat_id = air_seat_details.air_seat_id 
                    WHERE air_schedule_seat_info.ticket_id = $1 
                    AND air_schedule_seat_info.passenger_id = $2`,
                values: [ticketId, passengerId]
            }
            const seatInfo = await airPool.query(getSeatInfoQuery);
            const seatInfoData = seatInfo.rows[0];
            passenger.push(seatInfoData.seat_name);
            passenger.push(airFare);

            passengerData.push(passenger);
        }

        // Create ticket pdf
        const pdfDoc = await PDFDocument.create();

        // Add a page to the document
        const page = pdfDoc.addPage([600, 800]);

        const logoFilePath = path.join(__dirname, 'TripTixLogoBlack.png'); // Replace 'company_logo.png' with your logo file name
        const logoImageBytes = await fs.readFile(logoFilePath);

        const logoImage = await pdfDoc.embedPng(logoImageBytes);

        // Draw the company logo
        const logoDims = logoImage.scale(0.2); // Adjust the scale as needed
        page.drawImage(logoImage, {
            x: 50,
            y: page.getHeight() - logoDims.height - 50,
            width: logoDims.width,
            height: logoDims.height,
        });

        // Add a title
        page.drawText('TripTix', {
            x: 50,
            y: page.getHeight() - logoDims.height - 100,
            size: 30,
            font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            color: rgb(0.1, 0.1, 0.1), // Black 0.1, 0.1, 0.1
        });

        // Add Ticket ID, journey information, and payment details
        let startY = page.getHeight() - logoDims.height - 150;
        const lineSpacing = 25;

        const textLines = [
            `Journey Date:`,
            `${departureDate}`,
            `Journey Time:`,
            `${departureTime}`,
            `Starting Location:`,
            `${sourceName}`,
            `Destination Location:`,
            `${destinationName}`,
        ];

        let initalStart = startY;

        page.drawText('Ticket ID: ' + ticketId, {
            x: 50,
            y: startY,
            size: 15,
            font: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
            color: rgb(0.2, 0.2, 0.2),
        });

        startY -= lineSpacing;

        let k = 0;
        for (const line of textLines) {
            page.drawText(line, {
                x: 50,
                y: startY,
                size: 9,
                font: await pdfDoc.embedFont(k % 2 === 0 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica),
                color: rgb(0, 0, 0),
            });
            k++;
            startY -= 15;
        }

        startY = initalStart - lineSpacing;

        const textLines2 = [
            `Company Name:`,
            `${airServiceName}`,
            `Class:`,
            `${className}`,
            `Air ID`,
            `${uniqueAirId}`,
        ];

        k = 0;
        for (const line2 of textLines2) {
            page.drawText(line2, {
                x: page.getWidth() - 150,
                y: startY,
                size: 10,
                font: await pdfDoc.embedFont(k % 2 === 0 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica),
                color: rgb(0, 0, 0),
            });
            k += 1
            startY -= 15;
        }

        // Define colors
        const tableHeaderBackgroundColor = rgb(217 / 255, 196 / 255, 177 / 255);
        const tableBorderColor = rgb(0.7, 0.7, 0.7);

        // Define the table layout
        const tableX = 50;
        const tableY = 400;
        const rowHeight = 30;
        const colWidths = [120, 50, 50, 100, 80, 80];

        // Define the table header
        const tableHeader = ['Name', 'Age', 'Gender', 'Phone', 'Seat', 'Fare'];

        // Draw the table header with background color and border
        let currentY = tableY;
        for (let j = 0; j < tableHeader.length; j++) {
            // Draw background color rectangle for the table header cell
            page.drawRectangle({
                x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0),
                y: currentY,
                width: colWidths[j],
                height: rowHeight,
                color: tableHeaderBackgroundColor,
                borderColor: rgb(0.7, 0.7, 0.7),
                borderWidth: 1,
            });

            // Draw text for the table header cell
            page.drawText(tableHeader[j], {
                x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0) + 5, // Adjust the padding
                y: currentY + rowHeight / 2 - 6, // Center vertically
                size: 12,
                font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                color: rgb(0, 0, 0),
            });
        }
        currentY -= rowHeight;

        // Draw the table rows with borders
        for (const rowData of passengerData) {
            for (let j = 0; j < rowData.length; j++) {
                // Draw border rectangle for the table cell
                page.drawRectangle({
                    x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0),
                    y: currentY,
                    width: colWidths[j],
                    height: rowHeight,
                    borderColor: tableBorderColor,
                    borderWidth: 1,
                });

                // Draw text for the table cell
                page.drawText(`${rowData[j]}`, {
                    x: tableX + colWidths.slice(0, j).reduce((acc, width) => acc + width, 0) + 5, // Adjust the padding
                    y: currentY + rowHeight / 2 - 6, // Center vertically
                    size: 10,
                    font: await pdfDoc.embedFont(StandardFonts.Helvetica),
                    color: rgb(0, 0, 0),
                });
            }
            currentY -= rowHeight;
        }

        // Add the total price
        ; // Implement this function
        page.drawText(`Total Fare: Tk ${totalFare}`, {
            x: 400,
            y: currentY - 10,
            size: 15,
            font: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
            color: rgb(0.1, 0.1, 0.1),
        });

        // Add a rectangle above the existing one
        const upperRectX = tableX;
        const upperRectY = currentY - 60; // Adjust the vertical position as needed
        const upperRectWidth = page.getWidth() - 2 * tableX;
        const upperRectHeight = 30; // Adjust the height as needed

        page.drawRectangle({
            x: upperRectX,
            y: upperRectY,
            width: upperRectWidth,
            height: upperRectHeight,
            borderColor: rgb(0, 0, 0), // Border color (black)
            borderWidth: 1,
        });

        const textX = upperRectX + 20; // Adjust the horizontal position of text

        page.drawText('Transaction ID:', {
            x: textX,
            y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            color: rgb(0, 0, 0), // Text color (black)
        });

        page.drawText(transactionId, {
            x: textX + 100, // Adjust the horizontal position of text
            y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        page.drawText('Payment Method:', {
            x: textX + 250, // Adjust the horizontal position of text
            y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            color: rgb(0, 0, 0), // Text color (black)
        });

        page.drawText(paymentMedium, {
            x: textX + 350, // Adjust the horizontal position of text
            y: upperRectY + upperRectHeight - 15, // Adjust the vertical position as needed
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        const rectX = upperRectX;
        const rectY = upperRectY - 100; // Adjust the vertical position as needed
        const rectWidth = page.getWidth() - 2 * tableX;
        const rectHeight = 100; // Adjust the height as needed

        page.drawRectangle({
            x: rectX,
            y: rectY,
            width: rectWidth,
            height: rectHeight,
            borderColor: rgb(0, 0, 0), // Border color (black)
            borderWidth: 1,
        });

        // Add the terms and conditions as bullet points inside the rectangle

        const term1 = 'How to use the PDF: This PDF serves as your valid ticket for transportation. Simply display it on your mobile device or print it out';
        const term12 = 'and present it to the transportation staff for scanning or verification.';

        const term2 = 'Do not share with others: Please keep this ticket for your personal use only. Sharing it with others may result in loss of access ';
        const term21 = 'to the transportation service.';

        const term3 = 'Lost ticket: If you happen to lose this PDF ticket, please contact our customer support immediately at triptix.sfz@gmail.com';
        const term32 = 'to report the loss and request assistance. We will do our best to assist you in resolving the issue promptly.';


        const bulletX = rectX + 20; // Adjust the horizontal position of bullet points
        let bulletY = rectY + rectHeight - 20; // Adjust the vertical position of bullet points

        page.drawText('•', {
            x: bulletX,
            y: bulletY,
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Bullet point color (black)
        });

        page.drawText(term1, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        bulletY -= 10; // Adjust the vertical spacing between bullet points

        page.drawText(term12, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        bulletY -= 20; // Adjust the vertical spacing between bullet points

        page.drawText('•', {
            x: bulletX,
            y: bulletY,
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Bullet point color (black)
        });

        page.drawText(term2, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        bulletY -= 10; // Adjust the vertical spacing between bullet points

        page.drawText(term21, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        bulletY -= 20; // Adjust the vertical spacing between bullet points

        page.drawText('•', {
            x: bulletX,
            y: bulletY,
            size: 10,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Bullet point color (black)
        });

        page.drawText(term3, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        bulletY -= 10; // Adjust the vertical spacing between bullet points

        page.drawText(term32, {
            x: bulletX + 20, // Adjust the horizontal position of text
            y: bulletY,
            size: 8,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            color: rgb(0, 0, 0), // Text color (black)
        });

        // Serialize the PDF to a buffer
        const pdfBytes = await pdfDoc.save();
        const pdfBuffer = Buffer.from(pdfBytes.buffer);

        // Save ticket to firebase storage
        const mountainsRef = ref(storage, `${ticketId}.pdf`);
        await uploadBytes(mountainsRef, pdfBuffer);

        // Get ticket download url
        const downloadURL = await getDownloadURL(ref(storage, `${ticketId}.pdf`));
        console.log(downloadURL);

        const updateTicketInfoQuery = {
            text: `UPDATE ticket_info SET payment_medium = $1, payment_status = $2, transaction_id = $3, ticket_url = $4 WHERE ticket_id = $5`,
            values: [paymentMedium, 1, transactionId, downloadURL, ticketId]
        }
        await airPool.query(updateTicketInfoQuery);
        console.log('Ticket info updated to database');

        // Update air schedule info
        const updateAirScheduleQuery = {
            text: `UPDATE air_schedule_seat_info 
                SET booked_status = 2 
                WHERE air_schedule_id = $1 
                AND ticket_id = $2`,
            values: [airScheduleId, ticketId]
        }
        await airPool.query(updateAirScheduleQuery);
        console.log('Air schedule info updated to database');

        // Send ticket to user email
        const mailOptions = {
            from: 'triptix.sfz@gmail.com',
            to: userEmail,
            subject: `${ticketId} Ticket`,
            text: 'Here is your ticket. Enjoy your journey!',
            attachments: [
                {
                    filename: `${ticketId}.pdf`,
                    path: `${downloadURL}`,
                    contentType: 'application/pdf'
                }
            ]
        };
        await transporter.sendMail(mailOptions);
        console.log('Ticket sent to user email');
        airPool.query('COMMIT');

        return res.status(200).json({
            status: 'success',
            message: 'Payment Success',
            data: req.body
        });
    } catch (err) {
        airPool.query('ROLLBACK');
        console.log(err);
        return res.status(500).json({
            status: 'fail',
            message: 'Database error',
            data: err
        });
    }
}


module.exports = {
    paymentSuccessAir,
    paymentSuccessAirProfile
}