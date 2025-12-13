const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require("./service.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middlewares
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());
// mongodb connection url
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ftpnek1.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// main asyn function
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // -----------------------------------------------------------
    // database name
    const db = client.db("book_courier");
    // book collection
    const booksCollection = db.collection("books_all");

    // -----------------------------------------------------------
    // book add api
    app.post("/books_all", async (req, res) => {
      const bookData = req.body;
      console.log(bookData);
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    // -----------------------------------------------------------
    // all book get api
    app.get("/books_all", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    //-----------------------------------------------------------
    // single book details api
    app.get("/books_all/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //-----------------------------------------------------------
    // order collection
    //-----------------------------------------------------------
    const ordersCollection = db.collection("orders");

    //  order save api
    app.post("/orders", async (req, res) => {
      try {
        const orderData = req.body;

        // default order values
        orderData.status = "pending";
        orderData.paymentStatus = "unpaid";
        orderData.orderDate = new Date().toISOString().split("T")[0];

        const result = await ordersCollection.insertOne(orderData);

        res.status(201).send({ success: true, data: result });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Failed to save order" });
      }
    });

    //-----------------------------------------------------------
    // user personal orders by email api
    app.get("/orders", async (req, res) => {
      try {
        const email = req.query.email;

        const result = await ordersCollection
          .find({ "customer.email": email }) // customar email onujai
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to get orders" });
      }
    });

    //-----------------------------------------------------------
    // stripe payment session create / payment method
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.bookName,
                images: [paymentInfo?.imageURL],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: "payment",
        metadata: {
          bookId: paymentInfo?.bookId,
          customerEmail: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-orders?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-orders`,
      });
      res.send({ url: session.url });
    });

    //-----------------------------------------------------------
    // orders cancel api (user/seller)
    app.patch("/orders/cancel/:id", async (req, res) => {
      const id = req.params.id;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "cancelled",
          },
        }
      );
      res.send(result);
    });

    //-----------------------------------------------------------
    // librarian / seller  order get
    app.get("/orders/librarian", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email required" });

      const orders = await ordersCollection
        .find({ "seller.email": email }) // seller email onujai
        .toArray();

      res.send(orders);
    });

    // ------------------------------------------------------------------------
    // order status update (shipped / delivered)
    app.patch("/orders/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });
    // ------------------------------------------------------------------------

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
