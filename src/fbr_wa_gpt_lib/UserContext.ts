import { clients_config } from '../configs';
import { OpenAIAssistantWrapperV2 } from "./openai";

const CONTEXT_EXPIRATION_MINUTES = 40;

export type db_user = {
    id: string;
    mode: 'Menu' | 'Assistant';
    menu_location: string;
    active_chat: {
        assistant_runnable?: OpenAIAssistantWrapperV2;
        asistant_id: string;
    },
    set_response_style: "text" | "audio" | "text_audio" | "audio_text";
    last_context_update: Date;
};

let users: { [key: string]: db_user } = {};

export type type_getUserContext = {
    userId: string;
    asistant_id: string;
    mode: 'Menu' | 'Assistant';
};

export function getUserContext(args: type_getUserContext) {
    const { userId, asistant_id, mode } = args;
    const now = new Date();

    if (!users[userId]) {
        users[userId] = {
            id: userId,
            mode: mode,
            menu_location: '',
            active_chat: {
                asistant_id: asistant_id,
                assistant_runnable: undefined,
            },
            set_response_style: clients_config.default_response_style,
            last_context_update: now
        };
    } else {
        const lastUpdate = new Date(users[userId].last_context_update);
        const minutesSinceLastUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);

        if (minutesSinceLastUpdate > CONTEXT_EXPIRATION_MINUTES) {
            users[userId].active_chat.assistant_runnable = undefined;
        }
        users[userId].last_context_update = now;
    }

    return users[userId];
}

export function updateUser(userId: string, update: Partial<db_user>): Promise<db_user> {
    users[userId] = { ...users[userId], ...update };
    return Promise.resolve(users[userId]);
}
