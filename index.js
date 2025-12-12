const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./service.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middlewares
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ftpnek1.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // -----------------------------------------------------------
    const db = client.db("book_courier");
    const booksCollection = db.collection("books_all");

    // -----------------------------------------------------------
    // save a book data in db
    app.post("/books_all", async (req, res) => {
      const bookData = req.body;
      console.log(bookData);
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    // -----------------------------------------------------------
    // get all books from db
    app.get("/books_all", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    //-----------------------------------------------------------
    // get one book and details page from db
    app.get("/books_all/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //-----------------------------------------------------------
    //  add order collection
    const ordersCollection = db.collection("orders");

    // POST request → save order
    app.post("/orders", async (req, res) => {
      try {
        const orderData = req.body;

        // default values
        orderData.status = "pending";
        orderData.paymentStatus = "unpaid";
        orderData.orderDate = new Date().toISOString().split("T")[0]; // yyyy-mm-dd

        const result = await ordersCollection.insertOne(orderData);

        res.status(201).send({ success: true, data: result });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Failed to save order" });
      }
    });




    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("BookCurior is Runing Server");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
