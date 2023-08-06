const express = require('express');
const paymentController = require('../controllers/paymentController');
const bodyParser = require('body-parser').json();

const router = express.Router();

router.get('/paymentInit', paymentController.paymentInit);

router.post('/paymentSuccess', bodyParser, paymentController.paymentSuccess);

router.post('/paymentFail', bodyParser, paymentController.paymentFail);

router.post('/paymentCancel', bodyParser, paymentController.paymentCancel);

router.post('/paymentIpn', bodyParser, paymentController.paymentIpn);

module.exports = router;