require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 3000
const app = express()

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {

  const db = client.db('plantsDB')
  const plantCollection = db.collection('plants')
  const orderCollection = db.collection('orders')
  const userCollection = db.collection('users')

  try {


    const verifyAdmin = async (req, res, next) => {
      //  "req.user.email"  from verifyToken 
        const email = req?.user?.email
        const user = await userCollection.findOne({email})

        if(!user || user?.role !== 'admin'){
          return res.status(403).send({message:'anAuthorized access!' })
        }
      next()
    }
    const verifySeller = async (req, res, next) => {
      //  "req.user.email"  from verifyToken 
        const email = req?.user?.email
        const user = await userCollection.findOne({email})

        if(!user || user?.role !== 'seller'){
          return res.status(403).send({message:'anAuthorized access!' })
        }
      next()
    }


    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    // app.get('/logout', async (req, res) => {
    //   try {
    //     res
    //       .clearCookie('token', {
    //         maxAge: 0,
    //         secure: process.env.NODE_ENV === 'production',
    //         sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    //       })
    //       .send({ success: true })
    //   } catch (err) {
    //     res.status(500).send(err)
    //   }
    // })

    // users
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = "customer";
      user.create_at = new Date().toISOString()
      user.last_loggedin = new Date().toISOString()

      const query = { email: user?.email }

      const existingEmail = await userCollection.findOne(query)
      // console.log(existingEmail);

      if (existingEmail) {
        const result = await userCollection.updateOne(query, {
          $set: { last_loggedin: new Date().toISOString() }
        })
        return res.send(result)
      }

      const result = await userCollection.insertOne(user)
      res.send(result)
    })

    // get user's role
    app.get('/user/role/:email', async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email })
      res.send({ role: result?.role })
    })

    // get all users
    app.get('/allUsers', verifyToken,verifyAdmin, async (req, res) => {
      // console.log(req.user);
      const filter = {
        email: {
          // n for not, e for equal
          $ne: req?.user?.email
        }
      }
      const result = await userCollection.find(filter).toArray()
      res.send(result)
    })

    // update user role
    app.patch('/update/user/role/:email',verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const { role } = req.body
      const filter = { email: email }
      const updatedDoc = {
        $set: {
          role,
          status: 'varified'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    // request for seller
    app.patch('/become/seller/:email', async (req, res) => {
      const email = req.params.email
      const filter = { email: email }
      const updatedDoc = {
        $set: {
          status: 'requested'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })


    // admin-state
    app.get('/admin/statistic',verifyToken, async (req, res) => {

      const totalOrder = await orderCollection.estimatedDocumentCount()
      const totalPlant = await plantCollection.estimatedDocumentCount()
      const totalUser = await userCollection.estimatedDocumentCount()

      //  aggregation
      const result = await orderCollection.aggregate([
        {
          $addFields: {
            created_at: { $toDate: ('$_id') }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$created_at'
              }
            },
            revenue: { $sum: '$plantPrice' },
            orders: { $sum: 1 }
          }
        }
      ]).toArray()
      // change field name
      const chartData = result.map(data => ({
         Date: data._id,
       revenue: data.revenue,
        orders: data.orders
      }))

      const totalRevenue = result.reduce((sum, data) => sum + data?.revenue , 0 )
      // {totalOrder, totalPlant, totalUser}
      res.send({
        chartData, 
        totalOrder, 
        totalPlant, 
        totalUser,
        totalRevenue
      })
    })

    // add plants
    app.post('/plants',verifyToken, verifySeller, async (req, res) => {
      const newPlant = req.body
      const result = await plantCollection.insertOne(newPlant)
      res.send(result)
    })

    // get plants
    app.get('/plants', async (req, res) => {
      // const allplanst = req.body
      const result = await plantCollection.find().toArray()
      res.send(result)
    })

    // get a single plant
    app.get('/plant/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await plantCollection.findOne(query)
      res.send(result)
    })

    // get all order for customer
    app.get('/all/orders/customer/:email',verifyToken, async(req, res) => {
      const email = req.params.email
      const filter = {"customer.email" :email}
      const result = await orderCollection.find(filter).toArray()
      res.send(result)
    })


    // get all order for seller
    app.get('/all/orders/seller/:email',verifyToken, verifySeller, async(req, res) => {
      const email = req.params.email
      const filter = {"seller.email" :email}
      const result = await orderCollection.find(filter).toArray()
      res.send(result)
    })

    // create intent
    app.post('/create-intent', async (req, res) => {
      const { quantity, id } = req.body
      const plant = await plantCollection.findOne(
        { _id: new ObjectId(id) }
      )
      if (!plant) return res.status(404).send({ message: 'no plant found' })
      const totalPrice = quantity * plant.price * 100
      // srtipe
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice, // amount in cents
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: client_secret })
    })

    // // orders
    app.post('/orders', async (req, res) => {
      const orderData = req.body
      const result = await orderCollection.insertOne(orderData)
      res.send(result)
    })


    // update plant quantity  ( increase / decrease ) 
    app.patch('/update-quatity/:id', async (req, res) => {
      const id = req.params.id;
      const { updatedQuantity, status } = req.body;
      const filter = { _id: new ObjectId(id) }

      const updatedDoc = {
        $inc: { quantity: status === 'decrease' ? -updatedQuantity : updatedQuantity }
      }

      const result = await plantCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
