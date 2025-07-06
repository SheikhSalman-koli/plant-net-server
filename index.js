require('dotenv').config()
const express = require('express')
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')

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

// const verifyToken = async (req, res, next) => {
//   const token = req.cookies?.token

//   if (!token) {
//     return res.status(401).send({ message: 'unauthorized access' })
//   }
//   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
//     if (err) {
//       console.log(err)
//       return res.status(401).send({ message: 'unauthorized access' })
//     }
//     req.user = decoded
//     next()
//   })
// }


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

  try {
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const { email } = req.body
      const user = { email }
      if (!email) {
        return res.status(400).send({ error: 'Email is required' });
      }
      const token = jwt.sign(user, process.env.SECRET_KEY, { expiresIn: '2h' })

      res.cookie('token', token, {
        httpOnly: true,
        secure: false
      })

      res.send({ token })
      // .cookie('token', token, {
      //   httpOnly: true,
      //   secure: process.env.NODE_ENV === 'production',
      //   sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      // })

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


    // add plants
    app.post('/plants', async (req, res) => {
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

    // create intent
    app.post('/create-intent', async (req, res) => {
      const { quantity, id } = req.body
      const plant = await plantCollection.findOne(
        { _id: new ObjectId(id) }
      )
      if (!plant) return res.status(404).send({ message: 'no plant found' })
      const totalPrice = quantity * plant.price * 100
      // srtipe
      const {client_secret} = await stripe.paymentIntents.create({
        amount: totalPrice, // amount in cents
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({clientSecret: client_secret})
    })

    // // orders
    app.post('/orders', async(req,res)=>{
       const orderData = req.body
       const result = await orderCollection.insertOne(orderData)
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
