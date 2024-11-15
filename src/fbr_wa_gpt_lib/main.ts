import type { LogtoExpressConfig } from '@logto/express';
import { handleAuthRoutes, withLogto } from '@logto/express';
import cookieParser from 'cookie-parser';
import express, { Request, Response, Router } from 'express';
import session from 'express-session';
import * as fs from 'fs';
import qrcode from 'qrcode-terminal';
import { Op } from 'sequelize';
import { Client, LocalAuth, MessageTypes } from 'whatsapp-web.js';
import { sequelize, WhatsAppAccount, WhatsAppNotification } from './database';
import { verifyAccountStatus } from './middlewares/accountStatusMiddleware';
import TextOrSpeech from './TextOrSpeech/TextOrSpeech';
import { isProblemDetails } from './TS_Error';

const config: LogtoExpressConfig = {
    endpoint: process.env.LOGTO_endpoint as string,
    appId: process.env.LOGTO_appId as string,
    appSecret: process.env.LOGTO_appSecret as string,
    baseUrl: process.env.LOGTO_baseUrl as string, // Change to your own base URL
};

const clientsMap = new Map<string, Client>();
const clientsQRMap = new Map<string, number>();

// Define a port and start the Express server
const PORT = process.env.PORT || 3000;






export async function main() {

    // Start cron jobs
    // cron_jobs();
    // Initialize clients on start
    await initializeClients();

    await sequelize.sync();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(session({ secret: process.env.EXPRESS_COOKIE_SECRET as string, cookie: { maxAge: 14 * 24 * 60 * 60 } }));
    app.use(handleAuthRoutes(config));


    app.get('/', withLogto(config), (req, res) => {
        res.setHeader('content-type', 'text/html');

        if (req.user.isAuthenticated) {
            res.end(`<div>Hello ${req.user.claims?.sub}, <a href="/logto/sign-out">Sign Out</a></div>`);
        } else {
            res.end('<div><a href="/logto/sign-in">Sign In</a></div>');
        }
    });

    const router = Router();

    // Aplica el middleware de Logto y el middleware personalizado
    router.use(withLogto(config), verifyAccountStatus);



    app.get('/profile', withLogto(config), async (req, res) => {
        res.setHeader('content-type', 'text/html');

        const loggedInUserId = req.user.claims?.sub;

        if (!loggedInUserId) {
            // IDs don't match, show logout button
            res.end('<div>Acceso no autorizado. <a href="/logto/sign-out">Cerrar sesión</a></div>');
        } else {
            // IDs match, show profile and account status
            try {
                const account = await WhatsAppAccount.findOne({ where: { user_id: loggedInUserId } });

                let content = `
        <h1>Perfil de ${loggedInUserId}</h1>
        ${JSON.stringify(account, null, 2)}
        <div id="status" hx-get="/profile/status" hx-trigger="load every 5s" hx-swap="innerHTML">
          Cargando estado...
        </div>
        <script src="https://unpkg.com/htmx.org@1.9.2"></script>
      `;

                res.end(content);
            } catch (error) {
                console.error('Error fetching account data:', error);
                res.status(500).send('Error interno del servidor');
            }
        }
    });

    app.get('/profile/status', withLogto(config), async (req, res) => {
        const loggedInUserId = req.user.claims?.sub;

        if (!loggedInUserId) {
            res.status(403).send('Acceso no autorizado');
        } else {
            try {
                const account = await WhatsAppAccount.findOne({ where: { user_id: loggedInUserId } });
                if (account) {
                    let response = `<p>Estado: ${account.status}</p>`;
                    if (account.status === 'qr' && account.qr_code) {
                        // Display QR code for scanning
                        response += `
            <div id="qrCode">
              <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(account.qr_code)}&size=200x200" alt="Código QR">
            </div>
          `;
                    }
                    res.send(response);
                } else {
                    res.send('<p>No se encontraron datos de la cuenta.</p>');
                }
            } catch (error) {
                console.error('Error fetching account status:', error);
                res.status(500).send('Error interno del servidor');
            }
        }
    });


    // Ruta para enviar un mensaje
    router.post('/weebhook_logto', async (req, res) => {
        const data = req.body;
        initializeClient(data as any);

    });
    router.post('/send-message', async (req, res) => {
        const { user_id, chat_id, message } = req.body;
        const client = clientsMap.get(user_id);
        console.log('send-message:', req.body);
        if (client) {
            try {
                const result = await sendMessage(client, chat_id, message);
                console.log('Message sent:', result);
                return res.status(200).send({ result: result });
            } catch (error) {
                return res.status(500).send({ error: 'Error sending message: ' + error });
            }
        } else {
            return res.status(404).send({ error: 'Client not found' });
        }
    });


    // Get all contacts
    router.post('/get-contacts', async (req, res) => {
        console.log('get-contacts:', req.body);
        const { user_id } = req.body;
        const client = clientsMap.get(user_id);
        if (client) {
            try {
                const contacts = await client.getContacts();

                // Map the list into the desired shape
                const contacts_map = contacts.map(contact => {
                    const contactObj: any = {
                        wa_serialized_id: contact.id._serialized,
                        name: contact.name,
                        isGroup: contact.isGroup
                    };
                    if ((contact as any)?.description) {
                        contactObj.description = (contact as any).description;
                    }
                    return contactObj;
                });

                console.log('Contacts:', contacts_map);
                res.status(200).send({
                    count: contacts_map.length,
                    result: contacts_map,
                });
            } catch (error) {
                res.status(500).send({ error: 'Error getting contacts: ' + error });
            }
        } else {
            res.status(404).send({ error: 'Client not found' });
        }
    });

    // Get all groups
    router.post('/get-groups', async (req, res) => {
        console.log('get-groups:', req.body);
        const { user_id } = req.body;
        const client = clientsMap.get(user_id);
        if (client) {
            try {
                const groups = await client.getChats().then(chats => chats.filter(chat => chat.isGroup));

                // Map the list into the desired shape
                const groups_map = groups.map(contact => {
                    const contactObj: any = {
                        id: contact.id._serialized,
                        name: contact.name,
                        isGroup: contact.isGroup
                    };
                    if ((contact as any)?.description) {
                        contactObj.description = (contact as any).description;
                    }
                    return contactObj;
                });

                console.log('Groups:', groups_map);
                res.status(200).send({
                    count: groups_map.length,
                    result: groups_map
                });
            } catch (error) {
                res.status(500).send({ error: 'Error getting groups: ' + error });
            }
        } else {
            res.status(404).send({ error: 'Client not found' });
        }
    });



    // Get all contacts, with last message due to time limit
    router.post('/get-contacts-last-message-within-hours', async (req, res) => {
        console.log('get-contacts-last-message-within-hours:', req.body);
        const { user_id, hours = 24 } = req.body; // Default to 24 hours if not provided
        const client = clientsMap.get(user_id);
        if (client) {
            try {
                const chats = await client.getChats();
                const contacts_map = [];

                // Calculate the timestamp limit
                const currentTime = Math.floor(Date.now() / 1000); // current time in Unix timestamp
                const timeLimit = hours > 0 ? currentTime - (hours * 60 * 60) : 0; // time limit in Unix timestamp

                for (const chat of chats) {
                    const lastMessage = chat.lastMessage;

                    // Check if the last message is within the time limit
                    if (hours === 0 || (lastMessage && lastMessage.timestamp > timeLimit)) {
                        const contactObj: any = {
                            wa_serialized_id: chat.id._serialized,
                            name: chat.name,
                            isGroup: chat.isGroup
                        };
                        if ((chat as any)?.description) {
                            contactObj.description = (chat as any).description;
                        }
                        contacts_map.push(contactObj);
                    }
                }

                console.log('Contacts:', contacts_map);
                res.status(200).send({
                    count: contacts_map.length,
                    result: contacts_map,
                });
            } catch (error) {
                res.status(500).send({ error: 'Error getting contacts: ' + error });
            }
        } else {
            res.status(404).send({ error: 'Client not found' });
        }
    });




    const handle_get_chat_groupe_messages = async (req: Request, res: Response) => {
        console.log('get-chat-messages:', req.body);
        const { user_id, limit, chat_id, convert_audio_to_text } = req.body;
        const client = clientsMap.get(user_id);
        if (client) {
            try {
                const chat = await client.getChatById(chat_id);
                if (chat) {
                    const messages = await chat.fetchMessages({ limit: limit || 100 });

                    console.log('Messages:', messages);
                    if (convert_audio_to_text) {
                        const _TextOrSpeech = new TextOrSpeech();

                        // Use Promise.all to process all voice messages in parallel
                        await Promise.all(messages.map(async (message) => {
                            if (message.type === MessageTypes.VOICE) {
                                console.log('Voice message received');
                                const media = await message.downloadMedia();

                                try {
                                    const mp3_voice_file = await _TextOrSpeech.convertBase64_ogg_AudioToMP3(media.data);
                                    const voice_text = await _TextOrSpeech.SpeechToText(mp3_voice_file.mp3_file_path);

                                    let msg: string = voice_text as string;
                                    if (isProblemDetails(voice_text)) {
                                        console.error('Failed to transcribe audio file:', voice_text);
                                        msg = voice_text.args.detail || 'Failed to transcribe audio file';
                                    }

                                    console.log('Voice message transcribed:', msg);
                                    message.body = msg;
                                } catch (transcriptionError) {
                                    console.error('Error during voice message transcription:', transcriptionError);
                                    message.body = 'Failed to transcribe audio file';
                                }
                            }
                        }));
                    }

                    return res.status(200).send({ result: messages });
                } else {
                    console.log('Chat not found');
                    res.status(404).send({ error: 'Chat not found' });
                }
            } catch (error) {
                res.status(500).send({ error: 'Error getting chat messages: ' + error });
            }
        } else {
            res.status(404).send({ error: 'Client not found' });
        }
    }


    // get chat messages
    router.post('/get-chat-messages', handle_get_chat_groupe_messages);
    // Funcionalidad para ver contenido de un grupo
    router.post('/get-group-content', handle_get_chat_groupe_messages);

    app.use('/', router);


    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });


    // wait for 5 seconds before starting the cron jobs
    await new Promise(resolve => setTimeout(resolve, 5000));
    cron_jobs();
}




// Función para enviar un mensaje
async function sendMessage(client: Client, chat_id: any, message: string) {
    try {
        const chat = await client.getChatById(chat_id);
        if (chat) {
            // 1. Send seen before processing the message
            await client.sendSeen(chat_id);

            // 2. Start typing before sending a message
            await chat.sendStateTyping();

            // Wait for a random interval
            const minTime = 1000; // 1 second in milliseconds
            const maxTime = 4000; // 4 seconds in milliseconds

            const typingTime = Math.floor(Math.random() * (maxTime - minTime + 1) + minTime);

            console.log(`Tiempo de escritura estimado: ${typingTime.toFixed(2)} milisegundos`);

            await new Promise(resolve => setTimeout(resolve, typingTime));

            // 3. Stop typing before sending the message
            await chat.clearState();
            // 4. Send the text message
            await chat.sendMessage(message);

            return 'Message sent successfully';
        } else {
            throw new Error('Chat not found');
        }
    } catch (error) {
        throw new Error('Error sending message: ' + error);

    }
}

async function initializeClients() {
    try {
        const whatsappAccounts = await WhatsAppAccount.findAll();

        for (const clientData of whatsappAccounts) {
            await initializeClient(clientData);
        }
    } catch (error) {
        console.error('Error fetching clients:', error);
    }
}

async function client_unliked(clientData: WhatsAppAccount) {

    // we need to wait for 2 seconds before we can reinitialize the client,
    // we need to remove the folder of the client and then reinitialize the client
    // folder .wwebjs_auth/session-{clientData.user_id}
    // folder .wwebjs_auth/session-{clientData.user_id}

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Remove the folder of the client
    fs.rmdirSync(`./.wwebjs_auth/session-${clientData.user_id}`, { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Reinitialize the client
    initializeClient(clientData);
}

function wrapWithTryCatch<T extends object>(obj: T): T {
    return new Proxy(obj, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);
            if (typeof original === 'function') {
                return async function (...args: any[]) {
                    try {
                        return await original.apply(target, args);
                    } catch (error) {
                        console.error(`Error in method ${String(prop)}:`, error);
                    }
                };
            }
            return original;
        }
    }) as T;
}


async function initializeClient(clientData: WhatsAppAccount) {

    try {

        const _client = new Client({
            takeoverOnConflict: true,

            puppeteer: {
                headless: true,

                args: ["--no-sandbox", '--disable-setuid-sandbox'],


            },
            authStrategy: wrapWithTryCatch(new LocalAuth({
                clientId: clientData.user_id!,
            })),
            // webVersion: '2.3000.1014522270-alpha',
            // webVersionCache: {
            //     type: 'none',
            // },
            // webVersionCache: {
            //     type: 'remote',
            //     // remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014590669-alpha.html`,
            //     remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/v1.5.40/html/2.2412.54.html`,
            // }
        });


        const client = wrapWithTryCatch(_client);



        clientsQRMap.set(clientData.user_id!, 0);

        client.on('ready', async () => {
            console.log(`Client ${clientData.user_id} is ready!`);

            clientsQRMap.set(clientData.user_id!, 0);


            // Update the qr_code and status in the database
            await WhatsAppAccount.update(
                { qr_code: null, status: 'ready' },
                { where: { user_id: clientData.user_id } }
            );




        });

        client.on('remote_session_saved', () => {
            console.log('Remote session saved');
        });

        client.on('auth_failure', async (session) => {
            console.log('Auth failure:', session);
        });
        client.on('disconnected', async (reason) => {
            console.log('Client disconnected:', reason);
            clientsQRMap.set(clientData.user_id, -1);

            // Update the status in the database
            await WhatsAppAccount.update(
                { status: 'disconnected' },
                { where: { user_id: clientData.user_id } }
            );

            // Handle reconnection logic if needed
            await client.destroy();
            await client_unliked(clientData);
        });


        client.on('qr', async (qr) => {
            const qrCounter = clientsQRMap.get(clientData.user_id!) || 0;

            console.log('QR code generated:', qr);

            qrcode.generate(qr, { small: true });

            // update the qr code in the database
            await WhatsAppAccount.update(
                { qr_code: qr, status: 'qr' },
                { where: { user_id: clientData.user_id } }
            );

            if (qrCounter > 4) {
                console.log('QR code generated more than 4 times, restarting client...');
                client.destroy().then(() => client.initialize());
                clientsQRMap.set(clientData.user_id!, 0);
            }
        });

        client.on('auth_failure', (msg) => {
            console.error('Authentication failure:', msg);
        });


        client.on('message', async (message) => {
            // Enqueue message in Supabase

            // const { data, error } = await supabase.from('messages').insert([
            //     { client_id: clientData.id, message_id: message.id._serialized, body: message.body, status: 'pending' }
            // ]);
            // if (error) {
            //     console.error('Error enqueuing message:', error);
            //     return;
            // }

            // // Attempt to send webhook
            // const webhookUrl = clientData.webhook_url; // Assuming this field exists
            // try {
            //     const response = await fetch(webhookUrl, {
            //         method: 'POST',
            //         headers: { 'Content-Type': 'application/json' },
            //         body: JSON.stringify({ clientId: clientData.id, message: message.body })
            //     });

            //     if (response.ok) {
            //         await supabase.from('messages').update({ status: 'sent' }).eq('message_id', message.id._serialized);
            //     } else {
            //         console.error('Webhook response not ok:', response.statusText);
            //         await supabase.from('messages').update({ status: 'failed' }).eq('message_id', message.id._serialized);
            //     }
            // } catch (error) {
            //     console.error('Error sending webhook:', error);
            //     await supabase.from('messages').update({ status: 'failed' }).eq('message_id', message.id._serialized);
            // }
        });



        clientsMap.set(clientData.user_id!, client);


        try {
            await client.initialize();

        } catch (error) {
            console.error('Error initializing client:', error);
            throw error;
        }

        console.log('Client initialized:', clientData.user_id);


    } catch (error) {
        console.error('Error initializing client:', error);
    }


}

async function cron_jobs() {
    let doingTheJob = false;
    const interval_ms = 5000; // 5 seconds

    async function do_the_job() {
        const currentUnixTime = Math.floor(Date.now() / 1000);

        try {
            const notifications = await WhatsAppNotification.findAll({
                where: {
                    status: {
                        [Op.in]: ['pending', 'failed'],
                    },
                    send_message_at_unix: {
                        [Op.lte]: currentUnixTime,
                    },
                },
                order: [['send_message_at_unix', 'ASC']],
            });

            for (const notification of notifications) {
                const client = clientsMap.get(notification.user_id);
                if (client) {
                    try {
                        const result = await sendMessage(client, notification.wa_serialized_id, notification.message);
                        console.log('Message sent:', result);

                        // Update the status to 'sent'
                        await notification.update({ status: 'sent' });
                    } catch (error) {
                        console.error('Error sending message:', error);

                        // Update the status to 'failed'
                        await notification.update({ status: 'failed' });
                    }
                } else {
                    console.error('Client not found:', notification.user_id);
                }
            }
        } catch (error) {
            console.error('Error fetching notifications:', error);
        }
    }

    console.log('Starting cron job...');

    setInterval(async () => {
        if (doingTheJob) {
            console.log('Skipping cron job, already running...');
            return;
        }

        try {
            doingTheJob = true;
            await do_the_job();
        } catch (error) {
            console.error('Error running cron job:', error);
        } finally {
            doingTheJob = false;
        }
    }, interval_ms);
}
