const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { Storage } = require('megajs');
require('dotenv').config(); // Load MEGA credentials from .env

const {
    default: Nawa_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

const { nawaid } = require('./id');
const router = express.Router();

// Generate random ID for MEGA file
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

// Upload to MEGA
async function uploadCredsToMega(credsPath) {
    try {
        const storage = await new Storage({
            email: process.env.MEGA_EMAIL,
            password: process.env.MEGA_PASSWORD
        }).ready;

        console.log('MEGA initialized.');

        if (!fs.existsSync(credsPath)) {
            throw new Error(`File not found: ${credsPath}`);
        }

        const fileSize = fs.statSync(credsPath).size;
        const upload = await storage.upload({
            name: `${randomMegaId()}.json`,
            size: fileSize
        }, fs.createReadStream(credsPath)).complete;

        const fileNode = storage.files[upload.nodeId];
        const link = await fileNode.link();
        console.log('Uploaded MEGA link:', link);
        return link;

    } catch (err) {
        console.error('MEGA Upload Failed:', err.message);
        throw err;
    }
}

// Delete temp dir
function removeFile(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

// Main route
router.get('/', async (req, res) => {
    const id = nawaid();
    const number = req.query.number?.replace(/[^0-9]/g, '');

    async function NAWA_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);

        try {
            const Nawa = Nawa_Tech({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Safari')
            });

            if (!Nawa.authState.creds.registered && number) {
                await delay(1500);
                const code = await Nawa.requestPairingCode(number);
                console.log(`Pairing Code: ${code}`);

                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            Nawa.ev.on('creds.update', saveCreds);

            Nawa.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    await delay(5000);
                    const credsFilePath = path.join(__dirname, `./temp/${id}/creds.json`);

                    if (!fs.existsSync(credsFilePath)) {
                        console.error('creds.json not found.');
                        return;
                    }

                    const megaUrl = await uploadCredsToMega(credsFilePath);
                    const sid = megaUrl.includes('https://mega.nz/file/')
                        ? 'NAWA-MD~' + megaUrl.split('https://mega.nz/file/')[1]
                        : 'Error: Invalid MEGA URL';

                    const session = await Nawa.sendMessage(Nawa.user.id, { text: sid });

                    const NAWA_TEXT = `
🎉 *Welcome to NAWA-MD!* 🚀

🔒 *Your Session ID:* ${sid}
⚠️ _Keep it private and secure._

💡 *Next Steps:* 
1️⃣ Add SESSION_ID to your environment variables.
2️⃣ Enjoy WhatsApp automation with SITHUM-MD!

🔗 *Join Support Channel:* https://whatsapp.com/channel/0029Vac8SosLY6d7CAFndv3Z
⭐ *GitHub:* https://github.com/podi75nawa
`;

                    await Nawa.sendMessage(Nawa.user.id, { text: NAWA_TEXT }, { quoted: session });

                    await delay(100);
                    await Nawa.ws.close();
                    removeFile(`./temp/${id}`);
                } else if (
                    connection === 'close' &&
                    lastDisconnect?.error?.output?.statusCode !== 401
                ) {
                    console.log('Reconnecting...');
                    await delay(10000);
                    await NAWA_PAIR_CODE();
                }
            });

        } catch (error) {
            console.error('Pairing failed:', error.message);
            removeFile(`./temp/${id}`);
            if (!res.headersSent) {
                res.send({ code: 'Service is Currently Unavailable' });
            }
        }
    }

    await NAWA_PAIR_CODE();
});

module.exports = router;
