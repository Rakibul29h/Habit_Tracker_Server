const express=require('express');
const cors=require('cors');
require('dotenv').config();
const app=express();
app.use(express.json());
app.use(cors());


const port=process.env.PORT||3000;
const uri = process.env.MONGODB_URI;
const { MongoClient, ServerApiVersion } = require('mongodb');
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
    const database = client.db("habitTracker");
    const habitsCollection = database.collection("habits");

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
   
    await client.close();
  }
}
run().catch(console.dir);

app.listen(port,()=>{
    console.log(`Server is running on port ${port}`);
});