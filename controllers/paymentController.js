const SSLCommerzPayment = require("sslcommerz").SslCommerzPayment;
const dotenv = require('dotenv');
const busPool = require('../config/busDB');
const accountPool = require('../config/accountDB');
const { PDFDocument, rgb } = require('pdf-lib');
// const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { initializeApp } = require('firebase/app');
const {getStorage, ref, uploadBytes, getDownloadURL} = require('firebase/storage');

const firebaseConfig = {
    apiKey: "AIzaSyCDJi-2gcAPHMwulW3QqihYx2ziKIywuzs",
    authDomain: "triptix-b957f.firebaseapp.com",
    projectId: "triptix-b957f",
    storageBucket: "triptix-b957f.appspot.com",
    messagingSenderId: "901918179031",
    appId: "1:901918179031:web:0809fd815e0ace043d3a92",
    measurementId: "G-5X64R9L8SJ"
  };

const app = initializeApp(firebaseConfig);

const storage = getStorage(app);

const serviceAccount = require('../controllers/triptix-b957f-firebase-adminsdk-z2wyl-fd49cc0eaf.json');

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: 'triptix.sfz@gmail.com',
      pass: 'geviigtztnzsfnbm', // Use an "App Password" if you have 2-Step Verification enabled
    },
  });

dotenv.config();

const store_id = process.env.STOREID
const store_passwd = process.env.STOREPASSWORD
const is_live = false //true for live, false for sandbox

const mainUrl = process.env.MAINURL

//sslcommerz init
const paymentInit = async (req, res) => {
    const { ticketInfo, userId, grandTotalFare } = req.body;

    // Generate unique transaction ID of 20 characters length mixed with letters and numbers
    const transactionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Get today's date
    const today = new Date();
    const date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();

    // Get current time
    const time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();

    // Get current date and time
    const dateTime = date + ' ' + time;
    let ticketsIds = "";
    let busScheduleIds = "";
    for (let i = 0; i < ticketInfo.length; i++) {
        ticketsIds += ticketInfo[i].ticketId + '_';
        busScheduleIds += ticketInfo[i].busScheduleId + '_';
    }

    const data = {
        total_amount: grandTotalFare,
        currency: 'BDT',
        tran_id: transactionId, // use unique tran_id for each api call
        success_url: `${mainUrl}/paymentSuccess/\\${busScheduleIds}/\\${ticketsIds}`,
        fail_url: `${mainUrl}/paymentFail`,
        cancel_url: `${mainUrl}/cancel`,
        ipn_url: `${mainUrl}/paymentIpn`,
        shipping_method: 'Courier',
        product_name: 'Computer.',
        product_category: 'Electronic',
        product_profile: 'general',
        cus_name: 'Customer Name',
        cus_email: 'mahbubzeeon@gmail.com',
        cus_add1: 'Dhaka',
        cus_add2: 'Dhaka',
        cus_city: 'Dhaka',
        cus_state: 'Dhaka',
        cus_postcode: '1000',
        cus_country: 'Bangladesh',
        cus_phone: '01711111111',
        cus_fax: '01711111111',
        ship_name: 'Customer Name',
        ship_add1: 'Dhaka',
        ship_add2: 'Dhaka',
        ship_city: 'Dhaka',
        ship_state: 'Dhaka',
        ship_postcode: 1000,
        ship_country: 'Bangladesh',
    };
    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
    sslcz.init(data).then(async apiResponse => {
        // Redirect the user to payment gateway

        busPool.query('BEGIN');

        //save transaction info to database
        try {
            for (let i = 0; i < ticketInfo.length; i++) {
                const ticketId = ticketInfo[i].ticketId;
                const busScheduleId = ticketInfo[i].busScheduleId;
                const numberOfTickets = ticketInfo[i].numberOfTickets;
                const totalFare = ticketInfo[i].totalFare;
                const passengerInfo = ticketInfo[i].passengerIdArray;
                const insertIntoTicketInfoQuery = {
                    text: `INSERT INTO ticket_info (ticket_id, user_id, bus_schedule_id, 
                        number_of_tickets, total_fare, passenger_info, transaction_id, date) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    values: [ticketId, userId, busScheduleId, numberOfTickets, totalFare, passengerInfo, transactionId, dateTime]
                }
                await busPool.query(insertIntoTicketInfoQuery);
            }
            
            let GatewayPageURL = apiResponse.GatewayPageURL;
            console.log('Redirecting to: ', apiResponse.GatewayPageURL);
            busPool.query('COMMIT');
            console.log('Transaction info saved to database');
            return res.status(200).json({
                status: 'success',
                message: 'Payment Init',
                data: apiResponse,
                url: GatewayPageURL
                });
        } catch(err) {
            busPool.query('ROLLBACK');
            console.log(err);
            return res.status(500).json({
                status: 'fail',
                message: 'Database error',
                data: err
            });
        }
    });
}

//sslcommerz success
const paymentSuccess = async (req, res) => {

    busPool.query('BEGIN');

    const data = req.body;
    const { busScheduleIds, ticketIds } = req.body;
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
    const busScheduleIdArray = busScheduleIds.split('_');
    const ticketIdArray = ticketIds.split('_');
    console.log(transactionId, paymentMedium, busScheduleIdArray, ticketIdArray)
    try {
        for (let i = 0; i < ticketIdArray.length - 1; i++) {
            const ticketId = ticketIdArray[i];
            const busScheduleId = busScheduleIdArray[i];
    
            const updateTicketInfoQuery = {
                text: `UPDATE ticket_info SET payment_medium = $1, payment_status = $2 WHERE transaction_id = $3`,
                values: [paymentMedium, 1, transactionId]
            }
            await busPool.query(updateTicketInfoQuery);
            console.log('Ticket info updated to database');
    
            // Update bus schedule info
            const updateBusScheduleQuery = {
                text: `UPDATE bus_schedule_seat_info 
                SET booked_status = 2 
                WHERE bus_schedule_id = $1 
                AND ticket_id = $2`,
                values: [busScheduleId, ticketId]
            }
            await busPool.query(updateBusScheduleQuery);
            console.log('Bus schedule info updated to database');

            // Generate ticket
            const getTicketInfoQuery = {
                text: `SELECT * FROM ticket_info WHERE ticket_id = $1`,
                values: [ticketId]
            }
            const ticketInfo = await busPool.query(getTicketInfoQuery);
            const ticketInfoData = ticketInfo.rows[0];
            const numberOfTickets = ticketInfoData.number_of_tickets;
            const totalFare = ticketInfoData.total_fare;
            const passengerInfo = ticketInfoData.passenger_info;
            const date = ticketInfoData.date;
            const paymentStatus = ticketInfoData.payment_status;
            const userId = ticketInfoData.user_id;
            const getBusScheduleInfoQuery = {
                text: `SELECT * FROM bus_schedule_info WHERE bus_schedule_id = $1`,
                values: [busScheduleId]
            }
            const busScheduleInfo = await busPool.query(getBusScheduleInfoQuery);
            const busScheduleInfoData = busScheduleInfo.rows[0];
            const busId = busScheduleInfoData.bus_id;
            const departureDate = busScheduleInfoData.schedule_date;
            const departureTime = busScheduleInfoData.departure_time;
            const arrivalDate = "";
            const arrivalTime = "";
            const departureLocation = busScheduleInfoData.starting_point;
            const arrivalLocation = busScheduleInfoData.ending_point;
            const fare = busScheduleInfoData.bus_fare;
            // const getBusInfoQuery = {
            //     text: `SELECT * FROM bus WHERE bus_id = $1`,
            //     values: [busId]
            // }
            // const busInfo = await busPool.query(getBusInfoQuery);
            // const busInfoData = busInfo.rows[0];
            const busName = "busInfoData.bus_name";
            const busType = "busInfoData.bus_type";
            const busSeat = "busInfoData.bus_seat";
            const busSeatInfo = "busInfoData.bus_seat_info";
            const getPassengerInfoQuery = {
                text: `SELECT * FROM passenger_info WHERE passenger_id = ANY($1)`,
                values: [passengerInfo]
            }
            const passengerInfoData = await accountPool.query(getPassengerInfoQuery);
            const passengerInfoArray = passengerInfoData.rows;
            const passengerNameArray = [];
            const passengerAgeArray = [];
            const passengerGenderArray = [];
            const passengerPhoneArray = [];
            const passengerEmailArray = [];
            for (let i = 0; i < passengerInfoArray.length; i++) {
                // console.log(passengerInfoArray[i]);
                passengerNameArray.push(passengerInfoArray[i].passenger_name);
                passengerAgeArray.push(passengerInfoArray[i].passenger_age);
                passengerGenderArray.push(passengerInfoArray[i].gender);
                passengerPhoneArray.push(passengerInfoArray[i].passenger_mobile);
                passengerEmailArray.push(passengerInfoArray[i].passenger_email);

            }
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([600, 800]);
            // page.moveTo(0, page.getHeight() - 50);
            // page.lineTo(page.getWidth(), page.getHeight() - 50);
            // page.stroke();
            // page.moveTo(0, page.getHeight() - 100);
            // page.lineTo(page.getWidth(), page.getHeight() - 100);
            // page.stroke();
            // page.moveTo(0, page.getHeight() - 150);
            // page.lineTo(page.getWidth(), page.getHeight() - 150);
            // page.stroke();
            // page.moveTo(0, page.getHeight() - 200);
            // page.lineTo(page.getWidth(), page.getHeight() - 200);
            // page.stroke();
            // page.moveTo(0, page.getHeight() - 250);
            // page.lineTo(page.getWidth(), page.getHeight() - 250);
            // page.stroke();
            // page.moveTo(0, page.getHeight() - 300);
            // page.lineTo(page.getWidth(), page.getHeight() - 300);
            // page.stroke();
            
            // Add content to the page
            page.drawText('Ticket ID: ' + ticketId, {
                x: 50,
                y: page.getHeight() - 50,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Bus Name: ' + busName, {
                x: 50,
                y: page.getHeight() - 100,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Bus Type: ' + busType, {
                x: 50,
                y: page.getHeight() - 150,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Bus Seat: ' + busSeat, {
                x: 50,
                y: page.getHeight() - 200,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Bus Seat Info: ' + busSeatInfo, {
                x: 50,
                y: page.getHeight() - 250,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Departure Date: ' + departureDate, {
                x: 50,
                y: page.getHeight() - 300,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Departure Time: ' + departureTime, {
                x: 50,
                y: page.getHeight() - 350,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Arrival Date: ' + arrivalDate, {
                x: 50,
                y: page.getHeight() - 400,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Arrival Time: ' + arrivalTime, {
                x: 50,
                y: page.getHeight() - 450,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Departure Location: ' + departureLocation, {
                x: 50,
                y: page.getHeight() - 500,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Arrival Location: ' + arrivalLocation, {
                x: 50,
                y: page.getHeight() - 550,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Fare: ' + fare, {
                x: 50,
                y: page.getHeight() - 600,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Number of Tickets: ' + numberOfTickets, {
                x: 50,
                y: page.getHeight() - 650,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Total Fare: ' + totalFare, {
                x: 50,
                y: page.getHeight() - 700,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Passenger Name: ' + passengerNameArray, {
                x: 50,
                y: page.getHeight() - 750,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });
            page.drawText('Passenger Age: ' + passengerAgeArray, {
                x: 50,
                y: page.getHeight() - 800,
                size: 20,
                color: rgb(0, 0.53, 0.71),
            });

            // Serialize the PDFDocument to bytes (a Uint8Array)
            const pdfBytes = await pdfDoc.save();
            const pdfBuffer = Buffer.from(pdfBytes.buffer);

            // Save ticket to firebase storage
            const mountainsRef = ref(storage, `${ticketId}.pdf`);
            await uploadBytes(mountainsRef, pdfBuffer);

            // Get ticket download url
            const downloadURL = await getDownloadURL(ref(storage, `${ticketId}.pdf`));
            console.log(downloadURL);

            // Send ticket to user email
            const mailOptions = {
                from: 'triptix.sfz@gmail.com',
                to: 'mahbubzeeon@gmail.com',
                subject: 'Ticket',
                text: 'Ticket',
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
        busPool.query('COMMIT');

        // return res.redirect(`http://localhost:6969/profile`);

        return res.status(200).json({
            status: 'success',
            message: 'Payment Success',
            data: req.body
        });
    } catch (err) {
        busPool.query('ROLLBACK');
        console.log(err);
        return res.status(500).json({
            status: 'fail',
            message: 'Database error',
            data: err
        });
    }
}

//sslcommerz fail
const paymentFail = async (req, res) => {
    const data = req.body;
    const ssl = new SSLCommerzPayment(store_id, store_passwd, is_live)
    const validation = ssl.validate(data);
    validation.then(validation => {
        console.log('Validation fail');
        console.log(validation);
    }).catch(error => {
        console.log(error);
    });
    return res.status(200).json({
        status: 'fail',
        message: 'Payment Fail',
        data: req.body
    });
}

module.exports = {
    paymentInit,
    paymentSuccess,
    paymentFail,

}