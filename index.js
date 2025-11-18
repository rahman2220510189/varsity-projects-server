const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require ("fs");
require("dotenv").config();

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/upload", express.static("uploads"));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cjuyyb2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {

        const storage = multer.diskStorage({
            destination: (req, file, cd) => {
                if (!fs.existsSync('uploads')) {
                    fs.mkdirSync('uploads');
                }
                cb(null, 'uploads/');
            },

            filename: (req, file, cb) => {
                cb(null, Date.now() + path.extname(file.originalname)); // Appending extension
            },
        });
        const upload = multer({storage})
       
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('boss is sitting')
})

app.listen(port, () => {
    console.log(`Embedded server running on ${port}`);
})
