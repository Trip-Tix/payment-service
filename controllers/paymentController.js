const SSLCommerzPayment = require("sslcommerz").SslCommerzPayment;
const dotenv = require('dotenv');
const busPool = require('../config/busDB');
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
        ticketsIds += ticketInfo[i].ticketId + '-';
        busScheduleIds += ticketInfo[i].busScheduleId + '-';
    }

    const data = {
        total_amount: grandTotalFare,
        currency: 'BDT',
        tran_id: transactionId, // use unique tran_id for each api call
        success_url: `${mainUrl}/paymentSuccess\\${busScheduleIds}\\${ticketsIds}`,
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
    sslcz.init(data).then(apiResponse => {
        // Redirect the user to payment gateway

        //save transaction info to database
        for (let i = 0; i < ticketInfo.length; i++) {
            const ticketId = ticketInfo[i].ticketId;
            const busScheduleId = ticketInfo[i].busScheduleId;
            const numberOfTickets = ticketInfo[i].numberOfTickets;
            const totalFare = ticketInfo[i].totalFare;
            const passengerInfo = ticketInfo[i].passengerInfo;
            const insertIntoTicketInfoQuery = {
                text: `INSERT INTO ticket_info (ticket_id, user_id, bus_schedule_id, 
                    number_of_tickets, total_fare, passenger_info, transaction_id, date) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                values: [ticketId, userId, busScheduleId, numberOfTickets, totalFare, passengerInfo, transactionId, dateTime]
            }
            busPool.query(insertIntoTicketInfoQuery, (err, result) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({
                        status: 'fail',
                        message: 'Database error',
                        data: err
                    });
                }
                console.log('Ticket info saved to database');
            });
        }
        
        let GatewayPageURL = apiResponse.GatewayPageURL
        console.log('Redirecting to: ', apiResponse)
        return res.status(200).redirect(GatewayPageURL)
    });
}

//sslcommerz success
const paymentSuccess = async (req, res) => {

    // Get ticket id and bus schedule id from url using split
    const url = req.url;
    const urlArray = url.split('\\');
    const busScheduleIds = urlArray[1];
    const ticketIds = urlArray[2];

    const data = req.body;
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
    const busScheduleIdArray = busScheduleIds.split('-');
    const ticketIdArray = ticketIds.split('-');
    for (let i = 0; i < ticketIdArray.length - 1; i++) {
        const ticketId = ticketIdArray[i];
        const busScheduleId = busScheduleIdArray[i];

        const updateTicketInfoQuery = {
            text: `UPDATE ticket_info SET payment_medium = $1, payment_status = $2 WHERE transaction_id = $3`,
            values: [paymentMedium, 1, transactionId]
        }
        busPool.query(updateTicketInfoQuery, (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({
                    status: 'fail',
                    message: 'Database error',
                    data: err
                });
            }
            console.log('Ticket info updated to database');
        });

        // Update bus schedule info
        const updateBusScheduleQuery = {
            text: `UPDATE bus_schedule_seat_info 
            SET booked_status = 2 
            WHERE bus_schedule_id = $1 
            AND ticket_id = $2`,
            values: [busScheduleId, ticketId]
        }
        busPool.query(updateBusScheduleQuery, (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({
                    status: 'fail',
                    message: 'Database error',
                    data: err
                });
            }
            console.log('Bus schedule info updated to database');
        });
    }
    return res.status(200).json({
        status: 'success',
        message: 'Payment Success',
        data: req.body
    });
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