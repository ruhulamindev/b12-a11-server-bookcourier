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
    // --------------------------------------

    // book collection
    const booksCollection = db.collection("books_all");
    //-----------------------------------------------------------

    // order collection
    const ordersCollection = db.collection("orders");
    // -----------------------------------------------------------
    
    // user collection
    const userCollection = db.collection("users")
    
    // -----------------------------------------------------------

    // book add api
    app.post("/books_all", async (req, res) => {
      const bookData = req.body;
      console.log(bookData);
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    // -----------------------------------------------------------
    // all book get api (only published)
    app.get("/books_all", async (req, res) => {
      const result = await booksCollection
        .find({ status: "published" })
        .toArray();
      res.send(result);
    });

    // ------------------------------
    // seller books (own books, published/unpublished)
    app.get("/books/seller", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email required" });

      const books = await booksCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(books);
    });

    // ------------------------------
    // update a book (for seller)
    app.patch("/books_all/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await booksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
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
      // console.log(paymentInfo);
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
        mode: "payment",
        customer_email: paymentInfo?.customer?.email,
        metadata: {
          bookId: paymentInfo?.bookId,
          orderId: paymentInfo?.orderId,
          customerEmail: paymentInfo?.customer.email,
          quantity: paymentInfo?.quantity,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment?session_id={CHECKOUT_SESSION_ID}`,
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

    // payment success / endpoints
    app.post("/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        // console.log(session);

        // const book = await booksCollection.findOne({
        //   _id: new ObjectId(session.metadata.bookId),
        // });

        if (session.status !== "complete") {
          return res.status(400).send({ message: "Payment not completed" });

          // const orderInfo = {
          //   bookId: session.metadata.bookId,
          //   transactionId: session.payment_intent,
          //   customerEmail: session.metadata.customerEmail,
          //   status: "pending",
          //   seller: book.seller,
          //   name: book.name,
          //   price: book.price,
          //   category: book.category,
          //   quantity: session.metadata.quantity,
          //   totalPrice: book.price * session.metadata.quantity,
          // };
          // console.log(orderInfo);
        }
        const orderId = session.metadata.orderId;

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              paymentStatus: "paid",
              transactionId: session.payment_intent,
            },
          }
        );
        res.send({
          success: true,
          message: "Payment successful, order updated",
          result,
        });
      } catch (error) {
        console.error("Payment success error:", error);
        res.status(500).send({ message: "Payment update failed" });
      }
    });

    // ------------------------------------------------------------------------
// save or update a user in db
app.post("/user",async(req,res) =>{
  const userData = req.body
  // console.log(userData)
  const result = await userCollection.insertOne(userData)
  res.send(userData)
})











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
