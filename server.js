const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

const port = process.env.PORT || 3000;
const MAX_USERS = 1;
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 Hours
const MAX_EMAILS = 500; // Limit badha diya kyuki ab slow but safe process hai

app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.use(express.static(__dirname));

let activeSessions = new Map();

function generateToken() {
    return Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
}

function cleanupExpiredSessions() {
    const now = Date.now();
    let removed = 0;
    for (const [token, data] of activeSessions) {
        if (now - data.lastActivity > SESSION_TIMEOUT) {
            activeSessions.delete(token);
            removed++;
        }
    }
    if (removed > 0) console.log('[CLEANUP] ' + removed + ' session(s) expired.');
}

setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function validateSession(token) {
    if (!token || !activeSessions.has(token)) return false;
    const data = activeSessions.get(token);
    if (Date.now() - data.lastActivity > SESSION_TIMEOUT) {
        activeSessions.delete(token);
        return false;
    }
    data.lastActivity = Date.now();
    return true;
}

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin" && password === "kakwan") {
        cleanupExpiredSessions();
        if (activeSessions.size >= MAX_USERS) {
            return res.json({ success: false, msg: "User Limit Reached!" });
        }
        const token = generateToken();
        activeSessions.set(token, { loginTime: Date.now(), lastActivity: Date.now() });
        console.log('[LOGIN] Session started (24h)');
        return res.json({ success: true, token: token });
    }
    return res.json({ success: false, msg: "Invalid Credentials" });
});

app.post('/logout', (req, res) => {
    const { token } = req.body;
    if (token && activeSessions.has(token)) activeSessions.delete(token);
    res.json({ success: true });
});

app.post('/check-session', (req, res) => {
    const { token } = req.body;
    if (validateSession(token)) res.json({ valid: true });
    else res.json({ valid: false });
});

function replaceTags(str, greet, website, signature, email) {
    return str
        .replace(/\{greet\}/gi, greet || '')
        .replace(/\{website\}/gi, website || '')
        .replace(/\{signature\}/gi, signature || '')
        .replace(/\{email\}/gi, email || '');
}

function parseRecipients(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    const list = [];
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    for (const line of lines) {
        if(line.includes('\t')) {
            let parts = line.split('\t').map(p=>p.trim());
            if(parts.length >= 3 && emailRegex.test(parts[2])) {
                list.push({ greet: parts[0], website: parts[1], email: parts[2] });
                continue;
            }
        }
        if(line.includes(',')) {
            let parts = line.split(',').map(p=>p.trim());
            let emailPart = parts.find(p => emailRegex.test(p));
            if(emailPart){
                let idx = parts.indexOf(emailPart);
                let greet = idx > 0 ? parts.slice(0, idx).join(' ') : '';
                let website = idx > 1 ? parts[idx-1] : '';
                list.push({ greet, website, email: emailPart });
                continue;
            }
        }
        if(emailRegex.test(line)){
             list.push({ greet: '', website: '', email: line });
        }
    }
    return list;
}

// Sleep function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/send', async (req, res) => {
    const startTime = Date.now();
    const { senderAccountsString, subject, replyTo, message, to } = req.body;

    if (!senderAccountsString || !to) {
        return res.json({ success: false, msg: "Missing Accounts or Recipients." });
    }

    const lines = senderAccountsString.split('\n');
    const senders = [];
    
    lines.forEach(line => {
        if(!line.trim()) return;
        const parts = line.split(/\t|,|:/).map(p => p.trim()).filter(p => p);
        if (parts.length >= 2) {
            let email = parts[0];
            let pass = parts[1];
            let name = parts[2] || email.split('@')[0]; 
            if (email.includes('@')) senders.push({ email, pass, name });
        }
    });

    if (senders.length === 0) {
        return res.json({ success: false, msg: "No valid sender accounts found." });
    }

    const transporters = senders.map(s => {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: { user: s.email, pass: s.pass },
            connectionTimeout: 5000, 
            socketTimeout: 5000
        });
    });

    console.log('[INFO] Loaded ' + senders.length + ' accounts.');

    const recipients = parseRecipients(to);
    if (recipients.length === 0) {
        return res.json({ success: false, msg: "No valid recipients found." });
    }
    if (recipients.length > MAX_EMAILS) {
        return res.json({ success: false, msg: "Limit: Max " + MAX_EMAILS + " emails." });
    }

    // LOGIC CHANGE: Sequential Account Processing
    const totalRecipients = recipients.length;
    const totalAccounts = senders.length;
    const batchSize = 5; // 5-5 ke batch
    
    // Calculate how many emails each account should send
    // Example: 375 emails / 15 accounts = 25 emails per account
    const emailsPerAccount = Math.ceil(totalRecipients / totalAccounts);

    let sentCount = 0;
    let failCount = 0;

    console.log(`[START] Total Recipients: ${totalRecipients} | Accounts: ${totalAccounts} | Batch Size: ${batchSize}`);

    // Loop through each Account (Account 1, then Account 2, etc.)
    for (let accIndex = 0; accIndex < totalAccounts; accIndex++) {
        const currentSender = senders[accIndex];
        const currentTransporter = transporters[accIndex];

        // Determine the range of recipients for this specific account
        const startIdx = accIndex * emailsPerAccount;
        const endIdx = startIdx + emailsPerAccount;
        
        // Get the chunk of recipients for THIS account
        const accountRecipients = recipients.slice(startIdx, endIdx);

        if (accountRecipients.length === 0) continue;

        console.log(`\n[ACCOUNT ${accIndex + 1}/${totalAccounts}] ${currentSender.email} -> Processing ${accountRecipients.length} emails...`);

        // Process this account's recipients in batches of 5
        for (let i = 0; i < accountRecipients.length; i += batchSize) {
            // Get the batch (max 5 emails)
            const batch = accountRecipients.slice(i, i + batchSize);
            
            const batchNumber = (i / batchSize) + 1;
            const totalBatches = Math.ceil(accountRecipients.length / batchSize);

            console.log(`  -> Sending Batch ${batchNumber}/${totalBatches} (${batch.length} emails)...`);

            // Send all emails in this batch simultaneously (Parallel within batch)
            const promises = batch.map(recipient => {
                return new Promise(async (resolve) => {
                    try {
                        const personalSubject = replaceTags(subject, recipient.greet, recipient.website, currentSender.name, currentSender.email);
                        const personalMessage = replaceTags(message, recipient.greet, recipient.website, currentSender.name, currentSender.email);

                        const mailOptions = {
                            from: `"${currentSender.name}" <${currentSender.email}>`,
                            to: recipient.email,
                            subject: personalSubject,
                            text: personalMessage
                        };

                        if (replyTo) mailOptions.replyTo = replyTo;

                        await currentTransporter.sendMail(mailOptions);
                        sentCount++;
                        // Use process.stdout.write to keep console clean
                        process.stdout.write(`\r    [${currentSender.email}] Sent: ${sentCount}   `);
                        resolve(true);
                    } catch (err) {
                        failCount++;
                        console.log(`\n    ✗ Error [${currentSender.email}]: ${err.message}`);
                        resolve(false);
                    }
                });
            });

            // Wait for this batch of 5 to complete
            await Promise.all(promises);
            console.log(`\n  -> Batch ${batchNumber} Completed. Sent: ${sentCount} | Fail: ${failCount}`);

            // DELAY: 2 seconds wait before next batch (or next account)
            // Sirf tab wait karein agar ye last batch nahi thi
            if (i + batchSize < accountRecipients.length) {
                console.log(`  -> Waiting 2 seconds to prevent rate limit...`);
                await sleep(2000);
            }
        }
    }

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[DONE] Total: ${totalRecipients} | Sent: ${sentCount} | Fail: ${failCount} | Time: ${timeTaken}s`);

    res.json({ success: true, sent: sentCount, fail: failCount, timeTaken: timeTaken });
});

app.listen(port, '0.0.0.0', () => {
    console.log('Server running on port ' + port);
});