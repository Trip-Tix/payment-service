const SSLCommerzPayment = require("sslcommerz").SslCommerzPayment;
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const store_id = process.env.STOREID
const store_passwd = process.env.STOREPASSWORD
const is_live = false //true for live, false for sandbox

const port = process.env.PORT;

// Connect to Postgres
const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    client.query('SELECT NOW()', (err, result) => {
        release();
        if (err) {
            return console.error('Error executing query', err.stack);
        }
        console.log(`Connected to Postgres at ${result.rows[0].now}`);
    });
});

//sslcommerz init
const paymentInit = async (req, res) => {
    const data = {
        total_amount: 100,
        currency: 'BDT',
        tran_id: 'REF123', // use unique tran_id for each api call
        success_url: 'http://localhost:5005/paymentSuccess',
        fail_url: 'http://localhost:5005/fail',
        cancel_url: 'http://localhost:5005/cancel',
        ipn_url: 'http://localhost:5005/paymentIpn',
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
        let GatewayPageURL = apiResponse.GatewayPageURL
        console.log('Redirecting to: ', apiResponse)
        return res.status(200).redirect(GatewayPageURL)
    });
}

//sslcommerz success
const paymentSuccess = async (req, res) => {
    const data = req.body;
    const ssl = new SSLCommerzPayment(store_id, store_passwd, is_live)
    const validation = ssl.validate(data);
    validation.then(validation => {
        console.log('Validation success');
        console.log(validation);
    }).catch(error => {
        console.log(error);
    });
    return res.status(200).json({
        status: 'success',
        message: 'Payment Success',
        data: req.body
    });
}

// //sslcommerz ipn -- lage na
// const paymentIpn = async (req, res) => {
//     const data = req.body;
//     console.log('IPN data');
//     console.log(data);
//     ssl = new SSLCommerzPayment(store_id, store_passwd, is_live)
//     const validation = ssl.validate(data);
//     validation.then(validation => {
//         console.log('IPN validation');
//         console.log(validation);
//     }).catch(error => {
//         console.log(error);
//     });
// }

module.exports = {
    paymentInit,
    paymentSuccess
}