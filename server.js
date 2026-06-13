const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({limit: '50mb'})); 
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection Setup (Neon PostgreSQL)
const db = new Client({
  connectionString: "postgresql://neondb_owner:npg_GCk21yTDigfx@ep-bitter-tooth-a6hvt6rl.us-west-2.aws.neon.tech/neondb?sslmode=require",
});

db.connect()
  .then(async () => {
      console.log('✅ Successfully connected to Neon PostgreSQL Database!');
      
      // Database & Tables Setup (Postgres Syntax)
      try {
          await db.query(`CREATE TABLE IF NOT EXISTS users (username VARCHAR PRIMARY KEY, password TEXT, perms TEXT, role TEXT)`);
          
          let mdPerms = '{"sales":true,"workflow":true,"quotation":true,"delivery":true,"bom":true,"stock":true,"customer":true,"expenses":true,"payroll":true,"pnl":true,"users":true}';
          await db.query(`INSERT INTO users (username, password, perms, role) VALUES ('shan', '1234', $1, 'MD') ON CONFLICT (username) DO NOTHING`, [mdPerms]);
          
          await db.query(`CREATE TABLE IF NOT EXISTS inventory (item_name TEXT, qty REAL, price REAL, branch TEXT, UNIQUE(item_name, branch))`);
          await db.query(`CREATE TABLE IF NOT EXISTS customers (id TEXT, name TEXT, phone TEXT, address TEXT, branch TEXT, PRIMARY KEY(id, branch))`);
          await db.query(`CREATE TABLE IF NOT EXISTS orders (row_id SERIAL PRIMARY KEY, invoice_no TEXT, date TEXT, customer_name TEXT, item_name TEXT, qty REAL, total_amount REAL, discount REAL, paid REAL, balance REAL, payment_method TEXT, status TEXT, branch TEXT)`);
          
          await db.query(`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, date TEXT, description TEXT, amount REAL, branch TEXT)`);
          await db.query(`CREATE TABLE IF NOT EXISTS quotations (row_id SERIAL PRIMARY KEY, quote_no TEXT, date TEXT, customer_name TEXT, item_name TEXT, qty REAL, total_amount REAL, discount REAL, branch TEXT, status TEXT)`);
          await db.query(`CREATE TABLE IF NOT EXISTS deliveries (id SERIAL PRIMARY KEY, invoice_no TEXT, courier TEXT, tracking_no TEXT, cod_amount REAL, delivery_status TEXT, cod_status TEXT, branch TEXT, UNIQUE(invoice_no, branch))`);
          await db.query(`CREATE TABLE IF NOT EXISTS raw_materials (id SERIAL PRIMARY KEY, name TEXT, qty REAL, unit TEXT, unit_price REAL, branch TEXT, UNIQUE(name, branch))`);
          await db.query(`CREATE TABLE IF NOT EXISTS payroll (id SERIAL PRIMARY KEY, date TEXT, name TEXT, type TEXT, amount REAL, branch TEXT)`);
          
          console.log("✅ All Advanced PostgreSQL Tables Ready!");
      } catch (err) {
          console.error("❌ Table Creation Error:", err.message);
      }
  })
  .catch(err => console.error('❌ Database connection error:', err.stack));


// GET Route: Data Load on System Startup
app.get('/api/sync', async (req, res) => {
    let cloudMaster = {};
    let queries = [
        { key: 'users', query: "SELECT * FROM users" },
        { key: 'stock', query: "SELECT item_name as name, qty, price, branch as business FROM inventory" },
        { key: 'customers', query: "SELECT id, name, phone, address, branch as business FROM customers" },
        { key: 'orders', query: "SELECT invoice_no as id, date, customer_name as cust, item_name as item, qty, total_amount as total, discount, paid as paidAmount, balance as balanceAmount, payment_method as method, status, branch as business FROM orders" },
        { key: 'expenses', query: "SELECT date, description as desc, amount, branch as business FROM expenses" },
        { key: 'quotations', query: "SELECT quote_no as id, date, customer_name as cust, item_name as item, qty, total_amount as total, discount, status, branch as business FROM quotations" },
        { key: 'deliveries', query: "SELECT invoice_no, courier, tracking_no, cod_amount, delivery_status, cod_status, branch as business FROM deliveries" },
        { key: 'raw_materials', query: "SELECT name, qty, unit, unit_price, branch as business FROM raw_materials" },
        { key: 'payroll', query: "SELECT date, name, type, amount, branch as business FROM payroll" }
    ];

    try {
        for (let q of queries) {
            const result = await db.query(q.query);
            cloudMaster[q.key] = result.rows || [];
        }
        res.json(cloudMaster);
    } catch (err) {
        console.error("❌ Fetch Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST Route: Save / Update / Delete Data
app.post('/api/sync', async (req, res) => {
    const data = req.body;
    console.log(`📥 Backend Received Action: ${data.action}`);

    try {
        if (data.action === 'saveUser') {
            await db.query(`INSERT INTO users (username, password, perms, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, perms = EXCLUDED.perms, role = EXCLUDED.role`, 
            [data.username, data.password, JSON.stringify(data.perms), data.role]);
        } 
        else if (data.action === 'deleteUser') {
            await db.query(`DELETE FROM users WHERE username = $1`, [data.username]);
        }
        else if (data.action === 'saveOrder') {
            for (let i of data.items) {
                await db.query(`INSERT INTO orders (invoice_no, date, customer_name, item_name, qty, total_amount, discount, paid, balance, payment_method, status, branch) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, 
                [data.id, data.date, data.cust, i.name, i.qty, i.total, data.discount, data.paidAmount, data.balanceAmount, data.method, data.status, data.business]);
            }
        } 
        else if (data.action === 'updateOrderStatus') {
            await db.query(`UPDATE orders SET status = $1 WHERE invoice_no = $2 AND branch = $3`, [data.status, data.id, data.business]);
        } 
        // 🔥 INVOICE DELETE LOGIC 🔥
        else if (data.action === 'deleteOrder') {
            await db.query(`DELETE FROM orders WHERE invoice_no = $1`, [data.id]); 
            // මෙතන AND branch = $2 අයින් කලා, මොකද combined order එකකදී ශාඛා කිහිපයකින්ම මකා දැමිය යුතු නිසා.
        }
        else if (data.action === 'saveStock') {
            await db.query(`INSERT INTO inventory (item_name, qty, price, branch) VALUES ($1, $2, $3, $4) ON CONFLICT (item_name, branch) DO UPDATE SET qty = EXCLUDED.qty, price = EXCLUDED.price`, 
            [data.name, data.qty, data.price, data.business]);
        } 
        else if (data.action === 'deleteStock') {
            await db.query(`DELETE FROM inventory WHERE item_name = $1 AND branch = $2`, [data.name, data.business]);
        } 
        else if (data.action === 'saveCustomer') {
            await db.query(`INSERT INTO customers (id, name, phone, address, branch) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id, branch) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address`, 
            [data.id, data.name, data.phone, data.address, data.business]);
        } 
        else if (data.action === 'deleteCustomer') {
            await db.query(`DELETE FROM customers WHERE id = $1 AND branch = $2`, [data.id, data.business]);
        } 
        else if (data.action === 'saveExpense') {
            await db.query(`INSERT INTO expenses (date, description, amount, branch) VALUES ($1, $2, $3, $4)`, 
            [data.date, data.desc, data.amount, data.business]);
        } 
        else if (data.action === 'deleteExpense') {
            await db.query(`DELETE FROM expenses WHERE date = $1 AND description = $2 AND amount = $3 AND branch = $4`, 
            [data.date, data.desc, data.amount, data.business]);
        }
        else if (data.action === 'saveQuotation') {
            for (let i of data.items) {
                await db.query(`INSERT INTO quotations (quote_no, date, customer_name, item_name, qty, total_amount, discount, branch, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, 
                [data.id, data.date, data.cust, i.name, i.qty, i.total, data.discount, data.business, data.status]);
            }
        } 
        else if (data.action === 'updateQuotationStatus') {
            await db.query(`UPDATE quotations SET status = $1 WHERE quote_no = $2 AND branch = $3`, [data.status, data.id, data.business]);
        }
        else if (data.action === 'deleteQuotation') {
            await db.query(`DELETE FROM quotations WHERE quote_no = $1 AND branch = $2`, [data.id, data.business]);
        }
        else if (data.action === 'saveDelivery') {
            await db.query(`INSERT INTO deliveries (invoice_no, courier, tracking_no, cod_amount, delivery_status, cod_status, branch) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (invoice_no, branch) DO UPDATE SET courier = EXCLUDED.courier, tracking_no = EXCLUDED.tracking_no, cod_amount = EXCLUDED.cod_amount, delivery_status = EXCLUDED.delivery_status, cod_status = EXCLUDED.cod_status`, 
            [data.invoice_no, data.courier, data.tracking_no, data.cod_amount, data.delivery_status, data.cod_status, data.business]);
        } 
        else if (data.action === 'saveRawMaterial') {
            await db.query(`INSERT INTO raw_materials (name, qty, unit, unit_price, branch) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name, branch) DO UPDATE SET qty = EXCLUDED.qty, unit = EXCLUDED.unit, unit_price = EXCLUDED.unit_price`, 
            [data.name, data.qty, data.unit, data.unit_price, data.business]);
        } 
        else if (data.action === 'deleteRawMaterial') {
            await db.query(`DELETE FROM raw_materials WHERE name = $1 AND branch = $2`, [data.name, data.business]);
        }
        else if (data.action === 'savePayroll') {
            await db.query(`INSERT INTO payroll (date, name, type, amount, branch) VALUES ($1, $2, $3, $4, $5)`, 
            [data.date, data.name, data.type, data.amount, data.business]);
        }
        else if (data.action === 'deletePayroll') {
            await db.query(`DELETE FROM payroll WHERE date = $1 AND name = $2 AND amount = $3 AND branch = $4`, 
            [data.date, data.name, data.amount, data.business]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("❌ Action Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log(`🚀 SK Creations Enterprise Server Running with Postgres on PORT: ${PORT}`));