const express = require('express');
const paymentController = require('../controllers/paymentController');
const bodyParser = require('body-parser').json();

const router = express.Router();

router.get('/paymentInit', paymentController.paymentInit);

router.post('/paymentSuccess', bodyParser, paymentController.paymentSuccess);

module.exports = router;