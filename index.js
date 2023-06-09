const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
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

        // user related apis
        app.get('/selectedClass/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const result = await selectedClassesCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/selectedClass', verifyJWT, async (req, res) => {
            const classes = req.body;
            const result = selectedClassesCollection.insertOne(classes);
            res.send(result);
        })

        app.post('/selectedClasses', verifyJWT, async (req, res) => {
            const classes = req.body;
            const query = { _id: { $in: classes.selectedClasses.map(id => new ObjectId(id)) } };
            const result = await instructorClassesCollection.find(query).toArray();
            res.send(result);
        })


        // dashboard access related apis
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

        // instructor related apis
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

        // admin related apis
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

        app.patch('/updateClasses/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'approved'
                }
            }
            const result = await instructorClassesCollection.updateOne(filter, updateDoc);
            res.send(result)
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