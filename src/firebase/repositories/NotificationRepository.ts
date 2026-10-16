import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firestore';
import { auth } from '../config/auth';
import { FirestoreNotificationDocument } from '../types';
import { sanitizeFirestoreData } from '../utils/sanitize';
import { userRepository } from './UserRepository';
import { resolveCandidateName } from '../../utils/userNameUtils';

export interface INotificationRepository {
  findByUserId(userId: string): Promise<FirestoreNotificationDocument[]>;
  create(notification: Omit<FirestoreNotificationDocument, 'id' | 'createdAt'>, stableId?: string): Promise<FirestoreNotificationDocument>;
  findActiveInvitation(recipientId: string, senderId: string, jobId?: string): Promise<FirestoreNotificationDocument | null>;
  updateInvitationStatus(id: string, status: 'accepted' | 'declined'): Promise<void>;
  subscribeByUserId(userId: string, onChange: (items: FirestoreNotificationDocument[]) => void, onError?: (error: Error) => void): () => void;
  markAsRead(id: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export class NotificationRepository implements INotificationRepository {
  private collectionName = 'notifications';

  async findByUserId(userId: string): Promise<FirestoreNotificationDocument[]> {
    if (!isFirebaseConfigured) return [];
    try {
      const colRef = collection(db, this.collectionName);
      const q = query(colRef, where('userId', '==', userId), limit(50));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreNotificationDocument));
    } catch (err) {
      console.warn('NotificationRepository.findByUserId warning:', err);
      return [];
    }
  }

  async create(notifData: Omit<FirestoreNotificationDocument, 'id' | 'createdAt'>, stableId?: string): Promise<FirestoreNotificationDocument> {
    if (notifData.type === 'invitation') {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid || notifData.senderId !== currentUid) {
        throw new Error('Only the authenticated employer can send an invitation.');
      }
      if (!notifData.userId || notifData.recipientId !== notifData.userId || notifData.userId === currentUid) {
        throw new Error('Invitation recipient is invalid.');
      }
    }

    const now = new Date().toISOString();
    const id = stableId || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newNotif: FirestoreNotificationDocument = {
      ...notifData,
      id,
      createdAt: now,
    };

    if (!isFirebaseConfigured) return newNotif;

    try {
      const docRef = doc(db, this.collectionName, id);
      const cleanNotif = sanitizeFirestoreData(newNotif);
      await setDoc(docRef, cleanNotif);
      const persisted = await getDoc(docRef);
      if (!persisted.exists()) throw new Error(`Notification ${id} disappeared after creation`);
      return { id: persisted.id, ...persisted.data() } as FirestoreNotificationDocument;
    } catch (err) {
      console.warn('NotificationRepository.create warning:', err);
      throw err;
    }
  }

  subscribeByUserId(userId: string, onChange: (items: FirestoreNotificationDocument[]) => void, onError?: (error: Error) => void): () => void {
    if (!isFirebaseConfigured) {
      onChange([]);
      return () => undefined;
    }
    const q = query(collection(db, this.collectionName), where('userId', '==', userId), limit(100));
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as FirestoreNotificationDocument))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      onChange(items);
    }, (error) => onError?.(error));
  }

  async findActiveInvitation(recipientId: string, senderId: string, jobId?: string): Promise<FirestoreNotificationDocument | null> {
    if (!isFirebaseConfigured) return null;
    // Query only invitations sent by the authenticated employer. This avoids
    // reading a deterministic document ID that does not exist yet, which is
    // denied by rules that authorize reads using the existing document's sender.
    const q = query(
      collection(db, this.collectionName),
      where('senderId', '==', senderId),
      where('type', '==', 'invitation'),
      limit(50),
    );
    const snap = await getDocs(q);
    const invitation = snap.docs
      .map((item) => ({ id: item.id, ...item.data() } as FirestoreNotificationDocument))
      .find((item) =>
        item.invitationStatus === 'pending' &&
        item.userId === recipientId &&
        (jobId ? item.jobId === jobId : !item.jobId)
      );
    return invitation || null;
  }

  async updateInvitationStatus(id: string, status: 'accepted' | 'declined'): Promise<void> {
    if (!isFirebaseConfigured) return;
    const ref = doc(db, this.collectionName, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Invitation no longer exists.');
    const invitation = snap.data() as FirestoreNotificationDocument;
    if (invitation.type !== 'invitation' || invitation.invitationStatus !== 'pending') {
      throw new Error('This invitation is no longer pending.');
    }
    await updateDoc(ref, { invitationStatus: status, responseAt: new Date().toISOString(), read: true });
    if (invitation.senderId) {
      const recipient = await userRepository.findById(invitation.recipientId || invitation.userId);
      const recipientName = recipient ? resolveCandidateName(recipient).name : 'Name unavailable';
      try {
        await this.create({
          userId: invitation.senderId,
          title: `Invitation ${status}`,
          message: `${recipientName} has ${status} your invitation${invitation.jobId ? ` for ${invitation.jobId}` : ''}.`,
          type: 'invitation_response',
          link: '/employer/notifications',
          read: false,
          senderId: invitation.recipientId || invitation.userId,
          recipientId: invitation.senderId,
          jobId: invitation.jobId,
          invitationId: id,
          invitationStatus: status,
        });
      } catch (error) {
        console.warn('Invitation response persisted but employer notification failed:', error);
      }
    }
  }

  async markAsRead(id: string): Promise<void> {
    if (!isFirebaseConfigured) return;
    try {
      const docRef = doc(db, this.collectionName, id);
      await updateDoc(docRef, { read: true });
    } catch (err) {
      console.warn('NotificationRepository.markAsRead warning:', err);
      throw err;
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    if (!isFirebaseConfigured) return;
    try {
      const notifs = await this.findByUserId(userId);
      await Promise.all(
        notifs.map((n) => {
          if (!n.read) {
            const docRef = doc(db, this.collectionName, n.id);
            return updateDoc(docRef, { read: true });
          }
          return Promise.resolve();
        })
      );
    } catch (err) {
      console.warn('NotificationRepository.markAllAsRead warning:', err);
    }
  }

  async delete(id: string): Promise<void> {
    if (!isFirebaseConfigured) return;
    try {
      const docRef = doc(db, this.collectionName, id);
      await deleteDoc(docRef);
    } catch (err) {
      console.warn('NotificationRepository.delete warning:', err);
    }
  }
}

export const notificationRepository = new NotificationRepository();
