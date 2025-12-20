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
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

    app.get("/", async (req, res) => {
      res.send({ message: "Hello From server" });
    });

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
    // get public habit:

    app.get("/habit/public", async (req, res) => {
      const { filter, search } = req.query;

      const query = { visibility: "public" };
      if (filter) {
        query.category = filter;
      }
      if (search) {
        query.title = { $regex: search, $options: "i" };
      }
      const cursor = habitsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/habit-home",async(req,res)=>{
      const result = await habitsCollection.find({}).limit(6).sort({createdAt:-1}).toArray();
      res.send(result)
    })
    //  get my habit
    app.get("/habit", verifyFireBaseToken, async (req, res) => {
      const email = req.query.email;

      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.token_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      const habits = await habitsCollection.find(query).toArray();
      const today = new Date().setHours(0, 0, 0, 0);

      for (const habit of habits) {
        const lastDay = habit.lastCompletedDate
          ? new Date(habit.lastCompletedDate).setHours(0, 0, 0, 0)
          : null;

        if (lastDay !== today) {
          await habitsCollection.updateOne(
            {
              _id: habit._id,
            },
            { $set: { status: 0 } }
          );
          habit.status = 0;
        }
      }

      res.send(habits);
    });

    // add habit post method

    app.post("/habit", verifyFireBaseToken, async (req, res) => {
      const newHabit = req.body;
      console.log(newHabit);
      const result = await habitsCollection.insertOne(newHabit);
      console.log(result);
      res.send(result);
    });

    // update Completed Status;
    app.patch("/habit/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const query = { _id: new ObjectId(id) };
      const habit = await habitsCollection.findOne(query);
      if (!habit) return res.status(404).send({ message: "Habit not found" });

      if (updatedData) {
        const result = await habitsCollection.updateOne(query, {
          $set: {
            title: updatedData.title,
            description: updatedData.description,
            time: updatedData.time,
            visibility: updatedData.visibility,
            category: updatedData.category,
          },
        });
        return res.send(result);
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await habitsCollection.updateOne(query, {
          $push: {
            completionHistory: new Date(),
          },
        });
        const updatedHabit = await habitsCollection.findOne(query);
        const streak = calculateStreak(updatedHabit.completionHistory);
        const updatedResult = await habitsCollection.updateOne(query, {
          $set: { streak: streak, status: 1, lastCompletedDate: new Date() },
        });
        return res.send({
          modifiedCount: updatedResult.modifiedCount,
          streak: streak,
        });
      }
    });

    // delete Habit:

    app.delete("/habit/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await habitsCollection.deleteOne(query);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

function calculateStreak(history = []) {
  if (history.length === 0) return 0;
  const dates = history
    .map((d) => new Date(d).setHours(0, 0, 0, 0))
    .sort((a, b) => b - a);

  const today = new Date().setHours(0, 0, 0, 0);
  const yesterday = today - 1000 * 60 * 60 * 24;

  if (dates[0] !== today && dates[0] !== yesterday) {
    return 0;
  }
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const difference = (dates[i - 1] - dates[i]) / (1000 * 60 * 60 * 24);
    if (difference === 1) {
      streak++;
    } else if (difference > 1) {
      break;
    }
  }

  return streak;
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
