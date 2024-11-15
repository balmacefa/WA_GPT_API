import { DataTypes, Model, Optional, Sequelize } from "sequelize";

// WhatsAppAccount attributes
export interface WhatsAppAccountAttributes {
    user_id: string;
    qr_code?: string | null;
    status?: string | null;
}

// WhatsAppAccount creation attributes (when creating a new record)
export interface WhatsAppAccountCreationAttributes
    extends Optional<WhatsAppAccountAttributes, "qr_code" | "status"> { }

// WhatsAppNotification attributes
export interface WhatsAppNotificationAttributes {
    id: number;
    user_id: string;
    wa_serialized_id: string;
    message: string;
    status?: string;
    send_message_at_unix: number;
}

// WhatsAppNotification creation attributes (when creating a new record)
export interface WhatsAppNotificationCreationAttributes
    extends Optional<WhatsAppNotificationAttributes, "id" | "status"> { }


export const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./database.sqlite",
});

// WhatsAppAccount model
export class WhatsAppAccount
    extends Model<WhatsAppAccountAttributes, WhatsAppAccountCreationAttributes>
    implements WhatsAppAccountAttributes {
    public user_id!: string;
    public qr_code!: string | null;
    public status!: string | null;
}

WhatsAppAccount.init(
    {
        user_id: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        qr_code: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: "whatsapp_account",
    }
);

// WhatsAppNotification model
export class WhatsAppNotification
    extends Model<
        WhatsAppNotificationAttributes,
        WhatsAppNotificationCreationAttributes
    >
    implements WhatsAppNotificationAttributes {
    public id!: number;
    public user_id!: string;
    public wa_serialized_id!: string;
    public message!: string;
    public status!: string;
    public send_message_at_unix!: number;
}

WhatsAppNotification.init(
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        user_id: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        wa_serialized_id: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: "pending",
        },
        send_message_at_unix: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: "whatsapp_notifications",
    }
);
