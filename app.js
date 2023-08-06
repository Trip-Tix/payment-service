const express = require('express');
const dotenv = require('dotenv');
const router = require('./routes/routes');

dotenv.config();

const app = express();
const port = process.env.PORT;

app.use(express.json());
app.use('/', router);

app.get('/', (req, res) => {
    res.send('Payment service is up and running');
});

app.listen(port, () => {
    console.log(`Payment service listening on port ${port}`);
});