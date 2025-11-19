const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const { create } = require("domain");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

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
        await client.connect();
        const uploadItem = client.db("embedded-lab").collection("item");
        const collectionRecords = client.db("embedded-lab").collection("collectionRecords");




        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                if (!fs.existsSync('uploads')) {
                    fs.mkdirSync('uploads');
                }
                cb(null, 'uploads/');
            },

            filename: (req, file, cb) => {
                cb(null, Date.now() + path.extname(file.originalname)); // Appending extension
            },
        });
        const upload = multer({ storage });

        // Get Items with Pagination and Search

        app.get('/api/equipment', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 9;
                const search = req.query.search || '';
                const skip = (page - 1) * limit;

                // Search query
                const searchQuery = search ? {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } },
                        { purpose: { $regex: search, $options: 'i' } }
                    ]
                } : {};

                const total = await uploadItem.countDocuments(searchQuery);
                const items = await uploadItem.find(searchQuery)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json({
                    items,
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching items', error: error.message });
            }
        });

        // new search Suggestion endpoint
        app.get('/api/equipment/suggestions', async (req, res) => {
            try {
                const search = req.query.search || '';
                if (search.length < 2) {
                    return res.json([]);
                }
                const searchQuery = {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } },
                        { purpose: { $regex: search, $options: 'i' } }
                    ]
                };

                const suggestions = await uploadItem.find(searchQuery)
                    .project({ name: 1, image: 1 })
                    .limit(5)
                    .toArray();
                res.json(suggestions);

            } catch (error) {
                res.status(500).json({ message: 'Error fetching suggestions', error: error.message });
            }
        });

        // Upload Item
        app.post('/api/equipment', upload.single('image'), async (req, res) => {
            const { name, description, quantity, purpose, website } = req.body;
            try {
                const image = req.file.filename;
                const newItem = { name, quantity: parseInt(quantity), description, image, purpose, website, createdAt: new Date() };
                const result = await uploadItem.insertOne(newItem);
                res.status(201).json({ message: 'Item uploaded successfully', data: result });
            } catch (error) {
                res.status(500).json({ message: 'Error uploading item', error: error.message });
            }
        });

        //get single item
        app.get('/api/equipment/:id', async (req, res) => {
            try {
                const { ObjectId } = require('mongodb');
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const item = await uploadItem.findOne(query);

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }
                res.status(200).json(item);
            } catch (error) {
                res.status(500).json({ message: 'Error fetching item', error: error.message });
            }


        });

        // collect equipment 
        app.post('/api/equipment/:id/collect', async (req, res) => {
            try {
                const { ObjectId } = require('mongodb');
                const now = new Date();

                const {
                    collectQuantity,
                    userName,
                    userEmail,
                    userPhone,
                    department,
                    role,
                    Id,
                    section,
                    designation,
                    returnDate
                } = req.body;

                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const item = await uploadItem.findOne(query);

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }

                if (item.quantity < collectQuantity) {
                    return res.status(400).json({ message: 'Insufficient quantity available' });
                }


                await uploadItem.updateOne(
                    { _id: new ObjectId(id) },
                    { $inc: { quantity: -collectQuantity } }
                );


                let userInfo = {
                    userName,
                    userEmail,
                    userPhone,
                    department,
                    Id,
                    section,
                    designation,
                    role,
                };

                if (role === "student") {
                    userInfo.userName = userName;
                    userInfo.userEmail = userEmail;
                    userInfo.userPhone = userPhone;
                    userInfo.department = department;
                    userInfo.Id = Id;
                    userInfo.section = section;

                }

                if (role === "teacher") {
                    userInfo.userName = userName;
                    userInfo.userEmail = userEmail;
                    userInfo.Id = Id;
                    userInfo.userPhone = userPhone;
                    userInfo.department = department;
                    userInfo.designation = designation;
                }




                const collectionRecord = {
                    itemId: req.params.id,
                    itemName: item.name,
                    collectQuantity: parseInt(collectQuantity),
                    returnDate: new Date(returnDate),
                    collectedAt: now,
                    entryAt: now,
                    status: 'collected',
                    ...userInfo
                };

                await collectionRecords.insertOne(collectionRecord);

                res.status(200).json({
                    message: 'Item collected successfully',
                    collectionRecord
                });

            } catch (error) {
                res.status(500).json({ message: 'Error collecting item', error: error.message });
            }
        });

        // Return equipment

        // Return equipment (increase quantity)
        app.post('/api/equipment/:id/return', async (req, res) => {
            try {
                const { ObjectId } = require('mongodb');
                const { returnQuantity, userName, userEmail, Id } = req.body;

                const item = await uploadItem.findOne({ _id: new ObjectId(req.params.id) });

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }

                // Update quantity
                await uploadItem.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $inc: { quantity: returnQuantity } }
                );

                // Update collection record
                const db = uploadItem.s.db;
                await db.collection('collectionRecords').updateOne(
                    {
                        itemId: req.params.id,
                        userName,
                        userEmail,
                        Id,
                        status: 'collected'
                    },
                    {
                        $set: {
                            status: 'returned',
                            returnedAt: new Date()
                        }
                    }
                );

                res.json({ message: 'Item returned successfully' });
            } catch (error) {
                res.status(500).json({ message: 'Error returning item', error: error.message });
            }
        });

        //get all collect history
        app.get('/api/history', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const search = req.query.search || '';
                const status = req.query.status || '';
                const skip = (page - 1) * limit;

                let query = {};
                // build search query
                if (search) {
                    query.$or = [
                        { itemName: { $regex: search, $options: 'i' } },
                        { userName: { $regex: search, $options: 'i' } },
                        { userEmail: { $regex: search, $options: 'i' } },
                        { Id: { $regex: search, $options: 'i' } }
                    ];
                }
                if (status) {
                    query.status = status;
                }
                const total = await collectionRecords.countDocuments(query);
                const records = await collectionRecords.find(query) //  Records are fetched here
                    .sort({ entryAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                //enter history with item image
                const enrichedHistory = await Promise.all(
                    records.map(async (record) => {
                        const item = await uploadItem.findOne({ _id: new ObjectId(record.itemId) });
                        return {
                            ...record,
                            itemImage: item ? item.image : null
                        };
                    }
                    ));
                res.json({
                    history: enrichedHistory,
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching history', error: error.message });
            }
        });

        //get user specific history
        app.get('api/history/user/:email', async (req, res) => {
            try {
                const userEmail = req.params.email;
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const total = await collectionRecords.countDocuments({ userEmail });
                const history = await collectionRecords.find({ userEmail })
                    .sort({ entryAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                //enter item details 
                const enrichedHistory = await Promise.all(
                    history.map(async (record) => {
                        const item = await uploadItem.findOne({ _id: new ObjectId(record.itemId) });
                        return {
                            ...record,
                            itemImage: item ? item.image : null,
                            itemDescription: item ? item.description : null,
                        };
                    }
                    ));
                res.json({
                    history: enrichedHistory,
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching user history', error: error.message });
            }
        });


        // get statistics for dashboard
        app.get('/api/history/stats', async (req, res) => {
            try {
                const totalRecords = await uploadItem.countDocuments();
                const totalCollected = await collectionRecords.countDocuments({ status: 'collected' });
                const totalReturned = await collectionRecords.countDocuments({ status: 'returned' });

                const mostBorrowed = await collectionRecords.aggregate([
                    { $group: { _id: "$itemName", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 5 }
                ]).toArray();

                //get recent activities

                const recentActivities = await collectionRecords.find()
                    .sort({ entryAt: -1 })
                    .limit(5)
                    .toArray();

                res.json({
                    totalCollected,
                    totalReturned,
                    totalRecords,
                    activeLoans: totalCollected,
                    mostBorrowed,
                    recentActivities
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching statistics', error: error.message })

            }
        });

        //update equipment quantity
        app.put('/api/equipment/:id', upload.single('image'), async (req, res) => {
            try {
                const { ObjectId } = require('mongodb');
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const { name, description, quantity, purpose, website } = req.body;

                const item = await uploadItem.findOne(query);

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }
                const updatedData = {
                    name,
                    description,
                    quantity: parseInt(quantity),
                    purpose,
                    website,
                    updatedAt: new Date()
                };

                if (req.file) {
                    updatedData.image = req.file.filename;
                
                const oldImagePath = path.join(__dirname, 'uploads', item.image);
                if(fs.existsSync(oldImagePath)){
                    fs.unlinkSync(oldImagePath);
                }
            }
            const result = await uploadItem.updateOne(query, { $set: updatedData });
            res.json({
                message: 'Item updated successfully',
                result,
                uploadItem: {_id: id, ...updatedData}
            });

            }catch (error) {
                res.status(500).json({ message: 'Error updating item', error: error.message });
            };
        });


    //Delete equipment
    app.delete('/api/equipment/:id', async (req, res) => {
        try {
            const { ObjectId } = require('mongodb');
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const item = await uploadItem.findOne(query);

            if (!item) {
                return res.status(404).json({ message: 'Item not found' });
            }
            // Delete image file
            const imagePath = path.join(__dirname, 'uploads', item.image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            // Delete item from database
            const result = await uploadItem.deleteOne(query);
            res.json({ message: 'Item deleted successfully', result });
        }catch (error) {
            res.status(500).json({ message: 'Error deleting item', error: error.message });
        }
    })



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
