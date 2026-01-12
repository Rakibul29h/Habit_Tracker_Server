const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: ["https://habit-tracker-584de.web.app", "http://localhost:5173"]
  })
);
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);
// const serviceAccount = require("./habitTrackerAdminSdk.json");

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

    // get public habit:

    app.get("/habit/public", async (req, res) => {
      const { sort, limits, skip, search = "", filter } = req.query;
      const query = { visibility: "public" };
      if (filter) {
        query.category = filter;
      }
      if (search) {
        query.title = { $regex: search, $options: "i" };
      }
      const cursor = habitsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(Number(limits))
        .skip(Number(skip));
      const result = await cursor.toArray();
      const totalHabit = await habitsCollection.countDocuments(query);

      res.send({
        totalHabit: totalHabit,
        habit: result,
      });
    });

    app.get("/habit-home", async (req, res) => {
      const result = await habitsCollection
        .find({})
        .limit(12)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });
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
      const updatedHabit = habits.map((habit) => {
        let status = 0;
        let effectiveStreak = 0;
        if (habit.lastCompletedDate) {
          const lastDay = new Date(habit.lastCompletedDate).setHours(
            0,
            0,
            0,
            0
          );
          const diffdays = (today - lastDay) / 86400000;

          if (diffdays === 0) {
            status = 1;
          }

          if (diffdays === 0 || diffdays === 1) {
            effectiveStreak = calculateStreak(habit.completionHistory);
          }
        }
        return { ...habit, status, effectiveStreak };
      });

      res.send(updatedHabit);
    });

    // add habit post method

    app.post("/habit", verifyFireBaseToken, async (req, res) => {
      const newHabit = req.body;
      const result = await habitsCollection.insertOne(newHabit);
      res.send(result);
    });

    // update Completed Status;
    app.patch("/habit/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const query = { _id: new ObjectId(id) };
      const habit = await habitsCollection.findOne(query);
      if (!habit) return res.status(404).send({ message: "Habit not found" });
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
    });

    // get single Habit details:

    app.get("/singleHabit/:id", async (req, res) => {
      const { id } = req.params;
      const habit = await habitsCollection.findOne({ _id: new ObjectId(id) });
      if (!habit) {
        return res.status(404).send({ message: "Habit not found" });
      }

      const today = new Date().setHours(0, 0, 0, 0);
      let status = 0;
      let effectiveStreak = 0;

      if (habit.lastCompletedDate) {
        const lastDay = new Date(habit.lastCompletedDate).setHours(0, 0, 0, 0);
        const diffdays = (today - lastDay) / 86400000;

        if (diffdays === 0) {
          status = 1;
        }

        if (diffdays === 0 || diffdays === 1) {
          effectiveStreak = calculateStreak(habit.completionHistory);
        }
      }
      const progress = calculateProgress(
        habit.completionHistory,
        habit.createdAt
      );
      result = { ...habit, effectiveStreak, progress };
      res.send(result);
    });
    //  Completed Status API;
    app.patch("/habit/:id/complete", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const query = { _id: new ObjectId(id) };
      const habit = await habitsCollection.findOne(query);
      if (!habit) return res.status(404).send({ message: "Habit not found" });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (habit.lastCompletedDate) {
        const last = new Date(habit.lastCompletedDate);
        last.setHours(0, 0, 0, 0);
        if (last.getTime() === today.getTime()) {
          return res.status(400).send({ message: "Already completed today" });
        }
      }

      const history = [...(habit.completionHistory || []), today];
      const effectiveStreak = calculateStreak(history);
      const progress = calculateProgress(history, habit.createdAt);
      await habitsCollection.updateOne(query, {
        $set: {
          lastCompletedDate: today,
          status: 1,
          streak: effectiveStreak,
          progress: progress,
        },
        $push: {
          completionHistory: today,
        },
      });
      res.send({
        status: 1,
        effectiveStreak,
        progress,
      });
    });

    // delete Habit:

    app.delete("/habit/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await habitsCollection.deleteOne(query);
      res.send(result);
    });
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

// progress calculate
function calculateProgress(history = [], createdAt) {
  if (!createdAt) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const createdDate = new Date(createdAt);
  createdDate.setHours(0, 0, 0, 0);
  const daysSinceCreation =
    Math.floor((today - createdDate) / (1000 * 60 * 60 * 24)) + 1;
  const totalDays = Math.min(30, Math.max(daysSinceCreation, 1));
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - totalDays + 1);
  const completedDays = history.filter((d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date >= startDate && date <= today;
  });

  return Math.round((completedDays.length / totalDays) * 100);
}
app.get("/", async (req, res) => {
  res.send({ message: "Hello From server" });
});
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
