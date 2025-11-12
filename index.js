const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const app = express();
app.use(express.json());
app.use(cors());

const serviceAccount = require("./habitTrackerAdminSdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const port = process.env.PORT || 3000;
const uri = process.env.MONGODB_URI;
const { MongoClient, ServerApiVersion } = require("mongodb");
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFireBaseToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.token_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    await client.connect();
    const database = client.db("habitTracker");
    const habitsCollection = database.collection("habits");
    const userscollection = database.collection("users");

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = req.body.email;
      const query = { email: email };
      const existingUser = await userscollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists" });
      } else {
        const result = await userscollection.insertOne(user);
        res.send(result);
      }
    });

    // add habit post method

    app.post("/habit", verifyFireBaseToken, async (req, res) => {
      const newHabit = req.body;
      const result = await habitsCollection.insertOne(newHabit);
      res.send(result);
    });

    //  get my habit
            app.get('/habit', verifyFireBaseToken, async (req, res) => {
            const email = req.query.email;
            
            const query = {};
            if (email) {
                query.email = email;
                if(email !== req.token_email){
                    return res.status(403).send({message: 'forbidden access'})
                }
            }

            const cursor = habitsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
