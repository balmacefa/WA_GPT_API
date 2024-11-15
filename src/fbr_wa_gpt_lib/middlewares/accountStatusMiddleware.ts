import { NextFunction, Request, Response } from 'express';
import { WhatsAppAccount } from '../database';

export const verifyAccountStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user.claims?.sub;

        if (!userId) {
            return res.status(401).send('Usuario no autenticado');
        }

        const account = await WhatsAppAccount.findOne({ where: { user_id: userId } });

        if (!account) {
            // Si no hay cuenta, redirigir al perfil para configurarla
            return res.redirect(`/profile`);
        }

        if (account.status === 'qr') {
            // Si se necesita escanear el código QR, redirigir al perfil
            return res.redirect(`/profile`);
        }

        // Si todo está bien, continuar con la siguiente función
        next();
    } catch (error) {
        console.error('Error al verificar el estado de la cuenta:', error);
        res.status(500).send('Error interno del servidor');
    }
};
