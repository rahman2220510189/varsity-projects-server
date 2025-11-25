const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cjuyyb2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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
        const userCollection = client.db("embedded-lab").collection("users");

        //  Admin Activity Logs Collection
        const adminActivityLogs = client.db("embedded-lab").collection("adminActivityLogs");

        // JWT related API
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // Verify Token Middleware
        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            });
        };

        // Verify Admin Middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        };

        //  Admin Activity Logger Function
        const logAdminActivity = async (adminEmail, action, details) => {
            try {
                const log = {
                    adminEmail,
                    action,
                    details,
                    timestamp: new Date(),
                    ipAddress: details.ipAddress || 'N/A'
                };
                await adminActivityLogs.insertOne(log);
            } catch (error) {
                console.error('Error logging admin activity:', error);
            }
        };

        // Multer Storage Config
        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                if (!fs.existsSync('uploads')) {
                    fs.mkdirSync('uploads');
                }
                cb(null, 'uploads/');
            },
            filename: (req, file, cb) => {
                cb(null, Date.now() + path.extname(file.originalname));
            },
        });
        const upload = multer({ storage });

        // User Management APIs
        app.post('/api/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await userCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null });
            }

            const newUser = { ...user, role: 'user' };
            const result = await userCollection.insertOne(newUser);
            res.send(result);
        });

        app.get('/api/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;

            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        });

        app.get('/api/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        //  Make Admin with Logging
        app.patch('/api/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };

                // Get user details before update
                const targetUser = await userCollection.findOne(query);

                const updateDoc = {
                    $set: { role: 'admin' }
                };
                const result = await userCollection.updateOne(query, updateDoc);

                // 🆕 Log admin activity
                await logAdminActivity(req.decoded.email, 'MAKE_ADMIN', {
                    targetUserId: id,
                    targetUserEmail: targetUser?.email,
                    targetUserName: targetUser?.displayName || targetUser?.name || 'Unknown',
                    ipAddress: req.ip
                });

                res.send(result);
            } catch (error) {
                res.status(500).json({ message: 'Error making user admin', error: error.message });
            }
        });

        //  Delete User with Logging
        app.delete('/api/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };

                // Get user details before deletion
                const targetUser = await userCollection.findOne(query);

                const result = await userCollection.deleteOne(query);
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: 'User not found' });
                }

                //  Log admin activity
                await logAdminActivity(req.decoded.email, 'DELETE_USER', {
                    deletedUserId: id,
                    deletedUserEmail: targetUser?.email,
                    deletedUserName: targetUser?.displayName || targetUser?.name || 'Unknown',
                    ipAddress: req.ip
                });

                res.send({ message: 'User deleted successfully' });
            } catch (error) {
                res.status(500).json({ message: 'Error deleting user', error: error.message });
            }
        });

        // Equipment Management APIs
        app.get('/api/equipment', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 9;
                const search = req.query.search || '';
                const skip = (page - 1) * limit;

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

        // Search Suggestion endpoint
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

        app.post('/api/equipment', upload.single('image'), async (req, res) => {
            const { name, description, quantity, purpose, website, userEmail } = req.body;
            try {
                const image = req.file.filename;
                const newItem = {
                    name,
                    quantity: parseInt(quantity),
                    description,
                    image,
                    purpose,
                    website,
                    createdAt: new Date(),
                    createdBy: userEmail || 'Unknown' // userEmail frontend থেকে পাঠাতে হবে
                };
                const result = await uploadItem.insertOne(newItem);

                // Log admin activity (if userEmail provided)
                if (userEmail) {
                    await logAdminActivity(userEmail, 'ADD_ITEM', {
                        itemId: result.insertedId.toString(),
                        itemName: name,
                        quantity: parseInt(quantity),
                        ipAddress: req.ip
                    });
                }

                res.status(201).json({ message: 'Item uploaded successfully', data: result });
            } catch (error) {
                res.status(500).json({ message: 'Error uploading item', error: error.message });
            }
        });

        // Get single item
        app.get('/api/equipment/:id', async (req, res) => {
            try {
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

        // Collect equipment 
        app.post('/api/equipment/:id/collect', async (req, res) => {
            try {
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
                    userInfo = {
                        userName,
                        userEmail,
                        userPhone,
                        department,
                        Id,
                        section,
                        role
                    };
                }

                if (role === "teacher") {
                    userInfo = {
                        userName,
                        userEmail,
                        Id,
                        userPhone,
                        department,
                        designation,
                        role
                    };
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
        // app.post('/api/equipment/:id/return', async (req, res) => {
        //     try {
        //         const { returnQuantity, userName, userEmail, Id } = req.body;

        //         const item = await uploadItem.findOne({ _id: new ObjectId(req.params.id) });

        //         if (!item) {
        //             return res.status(404).json({ message: 'Item not found' });
        //         }

        //         await uploadItem.updateOne(
        //             { _id: new ObjectId(req.params.id) },
        //             { $inc: { quantity: returnQuantity } }
        //         );

        //         const db = uploadItem.s.db;
        //         await db.collection('collectionRecords').updateOne(
        //             {
        //                 itemId: req.params.id,
        //                 userName,
        //                 userEmail,
        //                 Id,
        //                 status: 'collected'
        //             },
        //             {
        //                 $set: {
        //                     status: 'returned',
        //                     returnedAt: new Date()
        //                 }
        //             }
        //         );

        //         res.json({ message: 'Item returned successfully' });
        //     } catch (error) {
        //         res.status(500).json({ message: 'Error returning item', error: error.message });
        //     }
        // });
        app.post('/api/equipment/:id/return', async (req, res) => {
            try {
                const { returnQuantity, userName, userEmail, Id } = req.body;

                // Validation
                if (!userEmail || !userName || !Id) {
                    return res.status(400).json({
                        message: 'Missing required user information'
                    });
                }

                const item = await uploadItem.findOne({ _id: new ObjectId(req.params.id) });
                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }

                // Update item quantity
                await uploadItem.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $inc: { quantity: parseInt(returnQuantity) } }
                );

                // Update collection record status
                const updateResult = await collectionRecords.updateOne(
                    {
                        itemId: req.params.id,
                        userName: userName,
                        userEmail: userEmail,  // ✅ Match by email
                        Id: Id,
                        status: 'collected'
                    },
                    {
                        $set: {
                            status: 'returned',
                            returnedAt: new Date()
                        }
                    }
                );

                // Log for debugging
                console.log('Return Update Result:', {
                    matchedCount: updateResult.matchedCount,
                    modifiedCount: updateResult.modifiedCount,
                    userEmail: userEmail
                });

                if (updateResult.matchedCount === 0) {
                    return res.status(404).json({
                        message: 'No matching collection record found'
                    });
                }

                res.json({
                    message: 'Item returned successfully',
                    updated: updateResult.modifiedCount > 0
                });
            } catch (error) {
                console.error('Error returning item:', error);
                res.status(500).json({
                    message: 'Error returning item',
                    error: error.message
                });
            }
        });

        // Get all collect history
        app.get('/api/history', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const search = req.query.search || '';
                const status = req.query.status || '';
                const skip = (page - 1) * limit;

                let query = {};
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
                const records = await collectionRecords.find(query)
                    .sort({ entryAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                const enrichedHistory = await Promise.all(
                    records.map(async (record) => {
                        const item = await uploadItem.findOne({ _id: new ObjectId(record.itemId) });
                        return {
                            ...record,
                            itemImage: item ? item.image : null
                        };
                    })
                );
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

        // Get user specific history
        app.get('/api/history/user/:email', async (req, res) => {
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

                const enrichedHistory = await Promise.all(
                    history.map(async (record) => {
                        const item = await uploadItem.findOne({ _id: new ObjectId(record.itemId) });
                        return {
                            ...record,
                            itemImage: item ? item.image : null,
                            itemDescription: item ? item.description : null,
                        };
                    })
                );
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

        // Get statistics for dashboard
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

        // Get equipment that are overdue
        app.get('/api/history/due', async (req, res) => {
            try {
                const now = new Date();
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const query = {
                    status: 'collected',
                    returnDate: { $lt: now }
                };

                const total = await collectionRecords.countDocuments(query);
                const overdueRecords = await collectionRecords.find(query)
                    .sort({ returnDate: 1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                const enrichedOverdueHistory = await Promise.all(
                    overdueRecords.map(async (record) => {
                        const item = await uploadItem.findOne({ _id: new ObjectId(record.itemId) });
                        return {
                            ...record,
                            itemImage: item ? item.image : null,
                            itemName: item ? item.name : record.itemName,
                            itemId: item ? item._id : record.itemId,
                        };
                    })
                );
                res.json({
                    dueHistory: enrichedOverdueHistory,
                    currentPage: page,
                    totalItems: total,
                    totalPages: Math.ceil(total / limit),
                });

            } catch (error) {
                res.status(500).json({ message: 'Error fetching overdue equipment list', error: error.message });
            }
        });

        // 🔄 Update equipment - NO MIDDLEWARE
        app.put('/api/equipment/:id', upload.single('image'), async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const { name, description, quantity, purpose, website, userEmail } = req.body;

                const item = await uploadItem.findOne(query);

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }

                const oldData = { ...item };

                const updatedData = {
                    name,
                    description,
                    quantity: parseInt(quantity),
                    purpose,
                    website,
                    updatedAt: new Date(),
                    updatedBy: userEmail || 'Unknown'
                };

                if (req.file) {
                    updatedData.image = req.file.filename;

                    const oldImagePath = path.join(__dirname, 'uploads', item.image);
                    if (fs.existsSync(oldImagePath)) {
                        fs.unlinkSync(oldImagePath);
                    }
                }
                const result = await uploadItem.updateOne(query, { $set: updatedData });

                // 🆕 Log admin activity
                if (userEmail) {
                    await logAdminActivity(userEmail, 'UPDATE_ITEM', {
                        itemId: id,
                        itemName: name,
                        changes: {
                            oldQuantity: oldData.quantity,
                            newQuantity: parseInt(quantity),
                            oldName: oldData.name,
                            newName: name
                        },
                        ipAddress: req.ip
                    });
                }

                res.json({
                    message: 'Item updated successfully',
                    result,
                    uploadItem: { _id: id, ...updatedData }
                });

            } catch (error) {
                res.status(500).json({ message: 'Error updating item', error: error.message });
            }
        });

        // 🔄 Delete equipment - NO MIDDLEWARE
        app.delete('/api/equipment/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const userEmail = req.query.userEmail; // Query parameter থেকে email নিবো
                const query = { _id: new ObjectId(id) };
                const item = await uploadItem.findOne(query);

                if (!item) {
                    return res.status(404).json({ message: 'Item not found' });
                }

                const imagePath = path.join(__dirname, 'uploads', item.image);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }

                const result = await uploadItem.deleteOne(query);

                // 🆕 Log admin activity
                if (userEmail) {
                    await logAdminActivity(userEmail, 'DELETE_ITEM', {
                        itemId: id,
                        itemName: item.name,
                        quantity: item.quantity,
                        ipAddress: req.ip
                    });
                }

                res.json({ message: 'Item deleted successfully', result });
            } catch (error) {
                res.status(500).json({ message: 'Error deleting item', error: error.message });
            }
        });

        // 🆕 Get All Admin Activity Logs
        app.get('/api/admin/activity-logs', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const action = req.query.action || '';
                const skip = (page - 1) * limit;

                let query = {};
                if (action) {
                    query.action = action;
                }

                const total = await adminActivityLogs.countDocuments(query);
                const logs = await adminActivityLogs.find(query)
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json({
                    logs,
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching admin logs', error: error.message });
            }
        });

        // 🆕 Get Specific Admin's Activity History
        app.get('/api/admin/my-activity/:email', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const adminEmail = req.params.email;
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const total = await adminActivityLogs.countDocuments({ adminEmail });
                const logs = await adminActivityLogs.find({ adminEmail })
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.json({
                    logs,
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                });
            } catch (error) {
                res.status(500).json({ message: 'Error fetching admin activity', error: error.message });
            }
        });

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Boss is sitting with Admin Activity Tracking! 🚀')
});

app.listen(port, () => {
    console.log(`Embedded server running on ${port}`);
});