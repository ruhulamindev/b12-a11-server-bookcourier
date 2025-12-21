const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();

const port = process.env.PORT || 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const serviceAccount = require("./service.json");

// firebase admin initialization
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

    // --------------------------------------
    // database name
    const db = client.db("book_courier");
    // --------------------------------------

    // book collection db
    const booksCollection = db.collection("books_all");
    //------------------------------------------
    // order collection db
    const ordersCollection = db.collection("orders");
    // ---------------------------------------------
    // user collection db
    const userCollection = db.collection("users");
    // --------------------------------------------
    // sellerRequestsCollection db
    const sellerRequestsCollection = db.collection("librarianRequests");

    // ---------------------------------------------
    // jwt verification middlewares
    const verifyJWT = async (req, res, next) => {
      const token = req?.headers?.authorization?.split(" ")[1];
      console.log(token);
      if (!token)
        return res.status(401).send({ message: "Unauthorized Access!" });
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.tokenEmail = decoded.email;
        console.log(decoded);
        next();
      } catch (err) {
        console.log(err);
        return res.status(401).send({ message: "Unauthorized Access!", err });
      }
    };

    // -------------------------------------------
    // all-books add/save api in db
    app.post("/books_all", async (req, res) => {
      const bookData = req.body;
      console.log(bookData);
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    // -----------------------------------------------------------
    // all-books get api (only published)
    app.get("/books_all", async (req, res) => {
      const result = await booksCollection
        .find({ status: "published" })
        .toArray();
      res.send(result);
    });

    // ------------------------------
    // get published/unpublished book api (librarian/seller)
    app.get("/books/seller", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email required" });

      const books = await booksCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(books);
    });

    // ------------------------------
    // update a book-detais (for librarian/seller)
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
    // get single book details page api
    app.get("/books_all/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //-----------------------------------------------------------
    //  db customer order save api
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
    // user personal orders get by email
    app.get("/orders", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        const result = await ordersCollection
          .find({ "customer.email": email }) // customar email onujai
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to get orders" });
      }
    });

    //-----------------------------------------------------------
    // orders cancel api (user or librarian/seller)
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
    // librarian/seller  order get (librarian/seller manage order api)
    app.get("/orders/librarian", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email required" });

      const orders = await ordersCollection
        .find({ "seller.email": email }) // seller email onujai
        .toArray();

      res.send(orders);
    });

    // ------------------------------------------------------------------------
    // order status update {shipped/delivered (librarian/seller)}
    app.patch("/orders/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });

    //-----------------------------------------------------------
    // stripe payment session create/payment method
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

    // ------------------------------------------------------------------------
    // payment success/endpoints
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
              totalPrice: session.amount_total / 100,
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
    // new users save and last login for existing user
    app.post("/user", async (req, res) => {
      const userData = req.body;
      // console.log(userData)
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "customer";

      const query = {
        email: userData.email,
      };

      const alreadyExists = await userCollection.findOne(query);
      console.log("User Already Exists--->", !!alreadyExists);
      if (alreadyExists) {
        console.log("Updateing user info.....");
        const result = await userCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      console.log("Saving new user info.....");

      const result = await userCollection.insertOne(userData);
      res.send(result);
    });

    // ------------------------------------------------------------------------
    // get all users (admin view)
    app.get("/users", async (req, res) => {
      try {
        const users = await userCollection
          .find({})
          .project({ name: 1, email: 1, role: 1, photoURL: 1 })
          .toArray();
        res.send(users);
      } catch (error) {
        console.error("Failed to fetch users:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // ------------------------------------------------------------------------
    // update user profile in MongoDB
    app.patch("/user/profile/update", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const { name, image } = req.body;

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: { name, image } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update user profile" });
      }
    });

    // ------------------------------------------------------------------------
    // get logged in user role
    app.get("/user/role/", verifyJWT, async (req, res) => {
      // console.log(req.tokenEmail)
      // const email = req.params.email;
      const result = await userCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    // ------------------------------------------------------------------------
    // save become a librarian request
    app.post("/become-librarian", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const { message } = req.body;

      const alreadyExists = await sellerRequestsCollection.findOne({ email });
      if (alreadyExists)
        return res
          .status(409)
          .send({ message: "You have already sent a request!" });

      const result = await sellerRequestsCollection.insertOne({
        email,
        message,
        // status: "pending",
        createdAt: new Date(),
      });
      res.send(result);
    });

    // ------------------------------------------------------------------------
    // // get current user's librarian requests
    app.get("/librarian-requests", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const requests = await sellerRequestsCollection
          .find({ email })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(requests);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch requests" });
      }
    });

    // ------------------------------------------------------------------------
    // update user role (admin) and remove request
    app.patch("/user/role/:id", async (req, res) => {
      const userId = req.params.id;
      const { newRole } = req.body;

      try {
        // find user
        const user = await userCollection.findOne({
          _id: new ObjectId(userId),
        });
        if (!user)
          return res
            .status(404)
            .send({ success: false, message: "User not found" });

        // update role
        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: newRole } }
        );

        // remove request from librarianRequests
        await sellerRequestsCollection.deleteOne({ email: user.email });

        res.send({
          success: true,
          message: "Role updated and request removed",
        });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to update role" });
      }
    });

    // ------------------------------------------------------------------------
    // invoices api (paid orders only)
    app.get("/invoices", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        const invoices = await ordersCollection
          .find({
            "customer.email": email,
            paymentStatus: "paid",
          })
          .project({
            transactionId: 1,
            bookName: 1,
            bookPrice: 1,
            quantity: 1,
            totalPrice: 1,
            orderDate: 1,
          })

          .toArray();

        res.send(invoices);
      } catch (error) {
        res.status(500).send({ message: "Failed to load invoices" });
      }
    });

    // ------------------------------------------------------------------------
    // Delete a book (admin)
    app.delete("/books_all/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await booksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount > 0) {
          res.send({ success: true, message: "Book deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Book not found" });
        }
      } catch (error) {
        console.error("Delete error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to delete book" });
      }
    });

    // ------------------------------------------------------------------------
    // Admin get all librarian requests
    app.get("/admin/librarian-requests", verifyJWT, async (req, res) => {
      try {
        const adminUser = await userCollection.findOne({
          email: req.tokenEmail,
        });

        if (adminUser?.role !== "admin") {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const requests = await sellerRequestsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.send(requests);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch requests" });
      }
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
