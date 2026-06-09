const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({limit: '50mb'})); 
app.use(express.static(path.join(__dirname, 'public')));

const dbFolder = path.join(__dirname, '.data');
if (!fs.existsSync(dbFolder)) { fs.mkdirSync(dbFolder); }

// Database Connection & Tables Setup
const db = new sqlite3.Database(path.join(dbFolder, 'sk_creations.db'), (err) => {
    if (err) console.error("❌ DB Connect Error:", err.message);
    else {
        db.serialize(() => {
            // 1. Users Table (With new Role column)
            db.run(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, perms TEXT, role TEXT)`);
            
            // MD Default User (All 11 permissions granted)
            let mdPerms = '{"sales":true,"workflow":true,"quotation":true,"delivery":true,"bom":true,"stock":true,"customer":true,"expenses":true,"payroll":true,"pnl":true,"users":true}';
            db.run(`INSERT OR IGNORE INTO users (username, password, perms, role) VALUES ('shan', '1234', ?, 'MD')`, [mdPerms]);
            
            // 2. Core Tables
            db.run(`CREATE TABLE IF NOT EXISTS inventory (item_name TEXT, qty REAL, price REAL, branch TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS customers (id TEXT, name TEXT, phone TEXT, address TEXT, branch TEXT, PRIMARY KEY(id, branch))`);
            db.run(`CREATE TABLE IF NOT EXISTS orders (row_id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT, date TEXT, customer_name TEXT, item_name TEXT, qty REAL, total_amount REAL, discount REAL, paid REAL, balance REAL, payment_method TEXT, status TEXT, branch TEXT)`);
            
            // 3. New Advanced Tables
            db.run(`CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, description TEXT, amount REAL, branch TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS quotations (row_id INTEGER PRIMARY KEY AUTOINCREMENT, quote_no TEXT, date TEXT, customer_name TEXT, item_name TEXT, qty REAL, total_amount REAL, discount REAL, branch TEXT, status TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT, courier TEXT, tracking_no TEXT, cod_amount REAL, delivery_status TEXT, cod_status TEXT, branch TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS raw_materials (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty REAL, unit TEXT, unit_price REAL, branch TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, name TEXT, type TEXT, amount REAL, branch TEXT)`);
            
            console.log("✅ Database and All Advanced Tables Ready!");
        });
    }
});

// GET Route: Data Load on System Startup (🔥 මේ කොටස තමයි Frontend එකට ගැලපෙන්න හැදුවේ 🔥)
app.get('/api/sync', (req, res) => {
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

    let completed = 0;
    queries.forEach(q => {
        db.all(q.query, [], (err, rows) => {
            if(err) console.error(`❌ Error reading ${q.key}:`, err.message);
            cloudMaster[q.key] = rows || [];
            completed++;
            if(completed === queries.length) {
                res.json(cloudMaster);
            }
        });
    });
});

// POST Route: Save / Update / Delete Data
app.post('/api/sync', (req, res) => {
    const data = req.body;
    console.log(`📥 Backend Received Action: ${data.action}`);

    try {
        if (data.action === 'saveUser') {
            db.run(`INSERT OR REPLACE INTO users (username, password, perms, role) VALUES (?, ?, ?, ?)`, 
            [data.username, data.password, JSON.stringify(data.perms), data.role]);
        } 
        else if (data.action === 'deleteUser') {
            db.run(`DELETE FROM users WHERE username = ?`, [data.username]);
        }
        else if (data.action === 'saveOrder') {
            data.items.forEach(i => {
                db.run(`INSERT INTO orders (invoice_no, date, customer_name, item_name, qty, total_amount, discount, paid, balance, payment_method, status, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [data.id, data.date, data.cust, i.name, i.qty, i.total, data.discount, data.paidAmount, data.balanceAmount, data.method, data.status, data.business]);
            });
        } 
        else if (data.action === 'updateOrderStatus') {
            db.run(`UPDATE orders SET status = ? WHERE invoice_no = ? AND branch = ?`, [data.status, data.id, data.business]);
        } 
        else if (data.action === 'saveStock') {
            db.run(`INSERT OR REPLACE INTO inventory (item_name, qty, price, branch) VALUES (?, ?, ?, ?)`, 
            [data.name, data.qty, data.price, data.business]);
        } 
        else if (data.action === 'deleteStock') {
            db.run(`DELETE FROM inventory WHERE item_name = ? AND branch = ?`, [data.name, data.business]);
        } 
        else if (data.action === 'saveCustomer') {
            db.run(`INSERT OR REPLACE INTO customers (id, name, phone, address, branch) VALUES (?, ?, ?, ?, ?)`, 
            [data.id, data.name, data.phone, data.address, data.business]);
        } 
        else if (data.action === 'deleteCustomer') {
            db.run(`DELETE FROM customers WHERE id = ? AND branch = ?`, [data.id, data.business]);
        } 
        else if (data.action === 'saveExpense') {
            db.run(`INSERT INTO expenses (date, description, amount, branch) VALUES (?, ?, ?, ?)`, 
            [data.date, data.desc, data.amount, data.business]);
        } 
        else if (data.action === 'deleteExpense') {
            db.run(`DELETE FROM expenses WHERE date = ? AND description = ? AND amount = ? AND branch = ?`, 
            [data.date, data.desc, data.amount, data.business]);
        }
        else if (data.action === 'saveQuotation') {
            data.items.forEach(i => {
                db.run(`INSERT INTO quotations (quote_no, date, customer_name, item_name, qty, total_amount, discount, branch, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [data.id, data.date, data.cust, i.name, i.qty, i.total, data.discount, data.business, data.status]);
            });
        } 
        else if (data.action === 'updateQuotationStatus') {
            db.run(`UPDATE quotations SET status = ? WHERE quote_no = ? AND branch = ?`, [data.status, data.id, data.business]);
        }
        else if (data.action === 'deleteQuotation') {
            db.run(`DELETE FROM quotations WHERE quote_no = ? AND branch = ?`, [data.id, data.business]);
        }
        else if (data.action === 'saveDelivery') {
            db.run(`INSERT OR REPLACE INTO deliveries (invoice_no, courier, tracking_no, cod_amount, delivery_status, cod_status, branch) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [data.invoice_no, data.courier, data.tracking_no, data.cod_amount, data.delivery_status, data.cod_status, data.business]);
        } 
        else if (data.action === 'saveRawMaterial') {
            db.run(`INSERT OR REPLACE INTO raw_materials (name, qty, unit, unit_price, branch) VALUES (?, ?, ?, ?, ?)`, 
            [data.name, data.qty, data.unit, data.unit_price, data.business]);
        } 
        else if (data.action === 'deleteRawMaterial') {
            db.run(`DELETE FROM raw_materials WHERE name = ? AND branch = ?`, [data.name, data.business]);
        }
        else if (data.action === 'savePayroll') {
            db.run(`INSERT INTO payroll (date, name, type, amount, branch) VALUES (?, ?, ?, ?, ?)`, 
            [data.date, data.name, data.type, data.amount, data.business]);
        }
        else if (data.action === 'deletePayroll') {
            db.run(`DELETE FROM payroll WHERE date = ? AND name = ? AND amount = ? AND branch = ?`, 
            [data.date, data.name, data.amount, data.business]);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("❌ Action Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log(`🚀 SK Creations Enterprise Server Running: http://localhost:${PORT}`));

// --- Automatic Backup Logic ---
const backupFolder = path.join(__dirname, 'backups');
if (!fs.existsSync(backupFolder)) { fs.mkdirSync(backupFolder); }

function performBackup() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const source = path.join(dbFolder, 'sk_creations.db');
    const destination = path.join(backupFolder, `sk_creations_backup_${date}.db`);

    fs.copyFile(source, destination, (err) => {
        if (err) console.error("❌ Backup Failed:", err);
        else console.log(`💾 Daily Database Backup Created: ${destination}`);
    });
}

// දවසකට සැරයක් (පැය 24කට) මේක රන් වෙනවා
setInterval(performBackup, 24 * 60 * 60 * 1000);

// මුල්ම පාරට සර්වර් එක ස්ටාර්ට් වෙද්දී බැකප් එකක් ගන්නවා
performBackup();