const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());



const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }

    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        }
        req.decoded = decoded;
        next();
    })

}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2b4mnlf.mongodb.net/?retryWrites=true&w=majority`;

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
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userCollection = client.db("summer-vacation").collection("users");
        const instructorClassesCollection = client.db("summer-vacation").collection("classes");
        const selectedClassesCollection = client.db("summer-vacation").collection("selected");
        const paidClassesCollection = client.db("summer-vacation").collection("paid");
        const feedbackCollection = client.db("summer-vacation").collection("feedbacks");

        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            };
            next();
        }

        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            };
            next();
        }


        app.get('/allClasses', async (req, res) => {
            const filter = { status: 'approved' };
            const result = await instructorClassesCollection.find(filter).toArray();
            res.send(result);
        })

        app.get('/popularClasses', async (req, res) => {
            const classes = { status: 'approved' };
            const result = await instructorClassesCollection.find(classes).limit(6).sort({ students: -1 }).toArray();
            res.send(result);
        })

        app.get('/allInstructors', async (req, res) => {
            const query = { role: 'instructor' };
            const result = await userCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/popularInstructors', async (req, res) => {
            const query = { role: 'instructor' };
            const result = await userCollection.find(query).limit(6).toArray();
            res.send(result);
        })

        app.post('/createUser', async (req, res) => {
            const user = req.body;
            const exist = { email: user.email };
            const isExist = await userCollection.findOne(exist);
            if (isExist) {
                return res.send({ message: 'user already exist, please login' });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // -----------------------------
        // user related apis
        // -----------------------------
        app.get('/selectedClass/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const result = await selectedClassesCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/selectedClass', verifyJWT, async (req, res) => {
            const classes = req.body;
            const exist = { email: classes.email, dbId: classes.dbId };
            const isExist = await selectedClassesCollection.findOne(exist);
            if (isExist) {
                return res.send('already added');
            }
            const result = await selectedClassesCollection.insertOne(classes);
            res.send(result);
        })

        app.post('/getOneClass', verifyJWT, async (req, res) => {
            const classes = req.body;
            const query = { email: classes.email, dbId: classes.id };
            const result = await selectedClassesCollection.findOne(query);
            res.send(result);
        })

        app.post('/selectedClasses', verifyJWT, async (req, res) => {
            const classes = req.body;
            const query = { _id: { $in: classes.selectedClasses.map(id => new ObjectId(id)) } };
            const result = await instructorClassesCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/paidClasses/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await paidClassesCollection.find(query).toArray();
            res.send(result);
        })

        app.patch('/updatingForPay', verifyJWT, async (req, res) => {
            const data = req.body;
            const stId = data._id;
            const dbId = data.id;
            const email = data.email;
            const transactionId = data.transactionId
            const date = new Date();
            const paid = { transactionId, email, date };

            const query = { _id: new ObjectId(stId) }

            const filter = { _id: new ObjectId(dbId) }
            const getData = await instructorClassesCollection.findOne(filter);
            const preSeats = getData.seats;
            const newSeats = preSeats - 1;

            if (newSeats <= 0) {
                return res.send('Seats not available');
            }

            const preStudents = getData.students;
            const newStudents = preStudents + 1;
            const update = {
                $set: {
                    seats: newSeats, students: newStudents
                }
            }

            const resultDelete = await selectedClassesCollection.deleteOne(query);
            const resultPaid = await paidClassesCollection.insertOne(paid);
            const resultUpdate = await instructorClassesCollection.updateOne(filter, update)
            res.send({ resultDelete, resultPaid, resultUpdate });
        })

        app.post('/deleteClass', verifyJWT, async (req, res) => {
            const data = req.body;
            const query = { email: data.email, dbId: data.id };
            const result = await selectedClassesCollection.deleteOne(query);
            res.send(result);
        })

        // --------------------------------
        // dashboard access related apis
        // --------------------------------
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const result = { admin: user?.role === 'admin' };
            res.send(result);
        })

        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ instructor: false });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' };
            res.send(result);
        })

        app.get('/users/student/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ student: false });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const result = { student: user?.role === 'student' };
            res.send(result);
        })

        // -------------------------
        // instructor related apis
        // -------------------------
        app.get('/deniedClasses/:email', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const result = await feedbackCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/instructorClasses', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            };
            const query = { instructorEmail: email };
            const result = await instructorClassesCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const classes = req.body;
            const result = await instructorClassesCollection.insertOne(classes);
            res.send(result);
        })

        // --------------------
        // admin related apis
        // --------------------
        app.get('/adminCanGetAllClasses', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            };
            const result = await instructorClassesCollection.find().toArray();
            res.send(result);
        })

        app.get('/adminCanGetAllUsers', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            };
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.patch('/updateClassStatus', verifyJWT, verifyAdmin, async (req, res) => {
            const data = req.body;
            const id = data.id;
            const status = data.status;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await instructorClassesCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        app.get('/getClassForFeedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await instructorClassesCollection.findOne(query);
            res.send(result);
        })

        app.post('/deniedDetails', verifyJWT, verifyAdmin, async (req, res) => {
            const data = req.body;
            const result = await feedbackCollection.insertOne(data);
            res.send(result);
        })

        app.patch('/authorization', verifyJWT, verifyAdmin, async (req, res) => {
            const data = req.body;
            const role = data.role;
            const id = data.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: role
                }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        // create payment intent 

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            if (price > 0) {
                const amount = price * 100;
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card']
                });
                res.send({
                    clientSecret: paymentIntent.client_secret
                })
            }
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Server Is Running Now!!');
});

app.listen(port, () => {
    console.log(`This server is running on port : ${port}`);
})