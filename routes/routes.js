const express = require('express');
const paymentController = require('../controllers/paymentController');
const bodyParser = require('body-parser').json();

const router = express.Router();

router.post('/paymentInit', paymentController.paymentInit);
router.post('/paymentSuccess', bodyParser, paymentController.paymentSuccess);
router.post('/paymentFail', bodyParser, paymentController.paymentFail);
router.get('/testPdf', paymentController.testPdf);

module.exports = router;