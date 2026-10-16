import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config/firestore';
import { auth } from '../firebase/config/auth';
import { companyRepository } from '../firebase/repositories/CompanyRepository';
import { applicationRepository } from '../firebase/repositories/ApplicationRepository';
import { interviewRepository } from '../firebase/repositories/InterviewRepository';
import { jobRepository } from '../firebase/repositories/JobRepository';
import { notificationRepository } from '../firebase/repositories/NotificationRepository';
import { userRepository } from '../firebase/repositories/UserRepository';
import { hiringCampaignRepository } from '../firebase/repositories/HiringCampaignRepository';
import { HiringCampaign } from '../types/campaign';
import { FirestoreApplicationDocument, FirestoreCompanyDocument } from '../firebase/types';
import { resolveCandidateName, isValidCandidateName } from './candidateDiscoveryService';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

export interface CompanyBrandAsset {
  id: string;
  name: string;
  url: string;
  type: string;
  size?: string;
  category?: 'banner' | 'logo' | 'source_file' | 'gallery' | 'document' | string;
  uploadedAt: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  logo: string;
  coverBanner: string;
  tagline?: string;
  customAccentColor?: string;
  industry: string;
  size: string;
  headquarters: string;
  website: string;
  email: string;
  phone: string;
  socialLinks: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    facebook?: string;
  };
  description: string;
  mission: string;
  vision: string;
  benefits: string[];
  culture: string;
  galleryPhotos: string[];
  brandAssets?: CompanyBrandAsset[];
  isVerified: boolean;
}

export interface EmployerCandidate {
  id: string;
  /** Firestore users/{uid} identity. `id` remains the application document id. */
  candidateUid: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  title: string;
  location: string;
  experienceYears: number;
  matchScore: number;
  skills: string[];
  appliedJobId: string;
  appliedJobTitle: string;
  stage: 'Applied' | 'Screening' | 'Shortlisted' | 'Interview' | 'Technical Round' | 'HR Round' | 'Offer' | 'Hired' | 'Rejected';
  appliedDate: string;
  resumeUrl: string;
  portfolioUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  summary: string;
  experienceHistory: Array<{
    role: string;
    company: string;
    duration: string;
    description: string;
  }>;
  education: Array<{
    degree: string;
    institution: string;
    year: string;
  }>;
  notes: Array<{
    id: string;
    author: string;
    text: string;
    createdAt: string;
  }>;
}

export interface ScheduledInterview {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId: string;
  jobTitle: string;
  date: string;
  time: string;
  durationMinutes: number;
  type: 'Screening' | 'Technical Round' | 'System Design' | 'HR & Culture';
  panelMembers: string[];
  notes: string;
  meetingLink: string;
  status: 'Scheduled' | 'Completed' | 'Rescheduled' | 'Cancelled';
}

export interface JobOffer {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId: string;
  jobTitle: string;
  baseSalary: number;
  signingBonus?: number;
  equity?: string;
  startDate: string;
  expirationDate: string;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Expired';
  sentDate: string;
  offerLetterUrl: string;
}

export interface EmployerTeamMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'Owner' | 'Hiring Manager' | 'Senior Recruiter' | 'Interviewer';
  department: string;
  status: 'Active' | 'Pending Invite' | 'Inactive';
  permissions: string[];
  joinedDate: string;
}

export interface EmployerNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  category: 'application' | 'interview' | 'offer' | 'job_expiry' | 'system';
  read: boolean;
  link?: string;
}

export interface EmployerAnalyticsData {
  applicationsReceived: number;
  viewsPerJob: number;
  avgTimeToHireDays: number;
  offerAcceptanceRate: number;
  pipelineConversion: Array<{ stage: string; count: number }>;
  topPerformingJobs: Array<{ id: string; title: string; views: number; applications: number; hires: number }>;
  sourceAttribution: Array<{ source: string; percentage: number }>;
  monthlyTrend: Array<{ month: string; applications: number; interviews: number; hires: number }>;
}

// Helpers
function mapStatusToStage(status: string): EmployerCandidate['stage'] {
  switch (status) {
    case 'submitted':
      return 'Applied';
    case 'under_review':
      return 'Screening';
    case 'shortlisted':
      return 'Shortlisted';
    case 'interviewing':
      return 'Technical Round';
    case 'offered':
      return 'Offer';
    case 'hired':
      return 'Hired';
    case 'rejected':
    case 'withdrawn':
      return 'Rejected';
    default:
      return 'Applied';
  }
}

function mapStageToStatus(stage: EmployerCandidate['stage']): FirestoreApplicationDocument['status'] {
  switch (stage) {
    case 'Applied':
      return 'submitted';
    case 'Screening':
      return 'under_review';
    case 'Shortlisted':
      return 'shortlisted';
    case 'Interview':
    case 'Technical Round':
    case 'HR Round':
      return 'interviewing';
    case 'Offer':
      return 'offered';
    case 'Hired':
      return 'offered';
    case 'Rejected':
      return 'rejected';
    default:
      return 'submitted';
  }
}

const STATUS_ORDER: FirestoreApplicationDocument['status'][] = [
  'submitted',
  'under_review',
  'shortlisted',
  'interviewing',
  'offered',
];

function isAllowedEmployerTransition(
  current: FirestoreApplicationDocument['status'],
  next: FirestoreApplicationDocument['status']
): boolean {
  if (current === next || next === 'rejected') return true;
  const currentIndex = STATUS_ORDER.indexOf(current);
  const nextIndex = STATUS_ORDER.indexOf(next);
  return currentIndex >= 0 && nextIndex >= currentIndex;
}

function formatRelativeTime(timestamp: string | number): string {
  if (!timestamp) return 'Recently';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================================
// EMPLOYER PORTAL SERVICE IMPLEMENTATION
// ============================================================================

export const employerPortalService = {
  // Company Profile
  getCompanyProfile: async (): Promise<CompanyProfile> => {
    const currentUid = auth.currentUser?.uid;
    const defaultProfile: CompanyProfile = {
      id: currentUid || 'comp-default',
      name: 'Organization Profile',
      logo: 'https://images.unsplash.com/photo-1549923746-c502d488b3ea?auto=format&fit=crop&w=160&q=80',
      coverBanner: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
      tagline: 'Leading the future of technology & talent',
      customAccentColor: 'blue',
      industry: 'Software & Technology',
      size: '50 - 200 Employees',
      headquarters: 'United States',
      website: '',
      email: auth.currentUser?.email || '',
      phone: '',
      socialLinks: {},
      description: 'Tech company hiring engineering and product talent.',
      mission: 'To create world-class software solutions.',
      vision: 'Driving technology forward with great teams.',
      benefits: ['Health & Dental Coverage', 'Flexible Work', 'Learning Stipend'],
      culture: 'Engineering-first culture centered around autonomy and craftsmanship.',
      galleryPhotos: [],
      brandAssets: [],
      isVerified: false,
    };

    if (!currentUid || !isFirebaseConfigured) {
      return defaultProfile;
    }

    try {
      const comp = await companyRepository.findByOwnerId(currentUid);
      if (comp) {
        return {
          id: comp.id,
          name: comp.name || defaultProfile.name,
          logo: comp.logoUrl || defaultProfile.logo,
          coverBanner: comp.bannerUrl || defaultProfile.coverBanner,
          tagline: comp.tagline || defaultProfile.tagline,
          customAccentColor: comp.customAccentColor || 'blue',
          industry: comp.industry || defaultProfile.industry,
          size: comp.companySize || defaultProfile.size,
          headquarters: comp.headquarters || defaultProfile.headquarters,
          website: comp.website || '',
          email: auth.currentUser?.email || '',
          phone: comp.phone || '',
          socialLinks: comp.socialLinks || {},
          description: comp.description || defaultProfile.description,
          mission: comp.mission || defaultProfile.mission,
          vision: comp.vision || defaultProfile.vision,
          benefits: comp.benefits || defaultProfile.benefits,
          culture: comp.culture || defaultProfile.culture,
          galleryPhotos: comp.galleryPhotos || [],
          brandAssets: comp.brandAssets || [],
          isVerified: comp.verificationStatus === 'verified',
        };
      }

      // Check user profile for fallback company fields
      const user = await userRepository.findById(currentUid);
      if (user && user.companyName) {
        return {
          ...defaultProfile,
          name: user.companyName,
          website: user.companyWebsite || '',
          industry: user.industry || defaultProfile.industry,
          size: user.companySize || defaultProfile.size,
        };
      }

      return defaultProfile;
    } catch (err) {
      console.warn('employerPortalService.getCompanyProfile error:', err);
      return defaultProfile;
    }
  },

  updateCompanyProfile: async (data: Partial<CompanyProfile>): Promise<CompanyProfile> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      const current = await employerPortalService.getCompanyProfile();
      return { ...current, ...data };
    }

    try {
      let comp = await companyRepository.findByOwnerId(currentUid);
      const companyDocData: Partial<FirestoreCompanyDocument> = {
        name: data.name,
        logoUrl: data.logo,
        bannerUrl: data.coverBanner,
        tagline: data.tagline,
        customAccentColor: data.customAccentColor,
        industry: data.industry,
        companySize: data.size,
        headquarters: data.headquarters,
        website: data.website,
        phone: data.phone,
        description: data.description,
        mission: data.mission,
        vision: data.vision,
        culture: data.culture,
        benefits: data.benefits,
        galleryPhotos: data.galleryPhotos,
        brandAssets: data.brandAssets,
        socialLinks: data.socialLinks,
      };

      if (comp) {
        await companyRepository.update(comp.id, companyDocData);
      } else {
        comp = await companyRepository.create({
          ownerId: currentUid,
          name: data.name || 'Company Profile',
          logoUrl: data.logo || '',
          bannerUrl: data.coverBanner || '',
          tagline: data.tagline || '',
          customAccentColor: data.customAccentColor || 'blue',
          industry: data.industry || 'Technology',
          companySize: data.size || '10-50',
          headquarters: data.headquarters || 'Remote',
          website: data.website || '',
          phone: data.phone || '',
          description: data.description || '',
          mission: data.mission || '',
          vision: data.vision || '',
          culture: data.culture || '',
          benefits: data.benefits || [],
          galleryPhotos: data.galleryPhotos || [],
          brandAssets: data.brandAssets || [],
          socialLinks: data.socialLinks || {},
          verificationStatus: 'pending',
        });
      }

      // Keep user doc companyName and branding in sync
      await userRepository.update(currentUid, {
        companyName: data.name,
        companyWebsite: data.website,
        industry: data.industry,
        companySize: data.size,
        companyLogo: data.logo,
      });

      return employerPortalService.getCompanyProfile();
    } catch (err) {
      console.warn('employerPortalService.updateCompanyProfile error:', err);
      return employerPortalService.getCompanyProfile();
    }
  },

  // Candidates & Applicants
  getCandidates: async (): Promise<EmployerCandidate[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }

    try {
      const [applications, jobs] = await Promise.all([
        applicationRepository.findByEmployerId(currentUid),
        jobRepository.findByEmployerId(currentUid),
      ]);

      const jobMap = new Map(jobs.map((j) => [j.id, j]));

      // Parallel batch resolution of unique candidate profiles
      const uniqueCandidateIds = Array.from(
        new Set(applications.map((a) => a.candidateId).filter(Boolean))
      );
      const candidateDocs = await Promise.all(
        uniqueCandidateIds.map((cid) =>
          userRepository.findById(cid).catch(() => null)
        )
      );
      const candidateMap = new Map<string, any>();
      uniqueCandidateIds.forEach((cid, idx) => {
        if (candidateDocs[idx]) {
          candidateMap.set(cid, candidateDocs[idx]);
        }
      });

      return applications.filter((app) => jobMap.has(app.jobId)).map((app) => {
        const job = jobMap.get(app.jobId);
        const stage = mapStatusToStage(app.status);
        const candidateUser = candidateMap.get(app.candidateId);

        const appDate = typeof app.appliedAt === 'string'
          ? app.appliedAt.split('T')[0]
          : new Date(app.appliedAt || Date.now()).toISOString().split('T')[0];

        const notesList: EmployerCandidate['notes'] = ((app as any).notes || []).map((n: any, idx: number) => {
          if (typeof n === 'string') {
            return {
              id: `note-${idx}`,
              author: 'Recruiter',
              text: n,
              createdAt: appDate,
            };
          }
          return n;
        });

        // Use authoritative candidate skills
        const candidateSkills: string[] = Array.isArray(candidateUser?.skills) && candidateUser.skills.length > 0
          ? candidateUser.skills
          : [];

        // Dynamic skill match based on genuine skills without fabricated defaults
        let matchScore = 0;
        if (job?.skills && job.skills.length > 0 && candidateSkills.length > 0) {
          const jobSkillsLower = job.skills.map((s: string) => s.toLowerCase());
          const matched = candidateSkills.filter((s: string) => jobSkillsLower.includes(s.toLowerCase())).length;
          matchScore = Math.round((matched / job.skills.length) * 100);
        }

        // Safely extract candidate experience history
        let expHistory: EmployerCandidate['experienceHistory'] = [];
        if (Array.isArray(candidateUser?.experience)) {
          expHistory = candidateUser.experience.map((e: any) => ({
            role: e.role || e.title || 'Role',
            company: e.company || 'Organization',
            duration: e.duration || e.period || '',
            description: e.description || '',
          }));
        }

        // Safely extract candidate education
        let eduHistory: EmployerCandidate['education'] = [];
        if (Array.isArray(candidateUser?.education)) {
          eduHistory = candidateUser.education.map((ed: any) => ({
            degree: ed.degree || 'Degree',
            institution: ed.institution || ed.school || 'Institution',
            year: ed.year || '',
          }));
        } else if (typeof candidateUser?.education === 'string' && candidateUser.education.trim()) {
          eduHistory = [{
            degree: candidateUser.education,
            institution: 'Verified Education',
            year: '',
          }];
        }

        const resolvedCandidateName = resolveCandidateName(candidateUser);
        const candidateName = !resolvedCandidateName.isUnavailable
          ? resolvedCandidateName.name
          : (app.candidateName && isValidCandidateName(app.candidateName) ? app.candidateName.trim() : 'Name unavailable');

        const avatar = candidateUser?.avatarUrl ||
          candidateUser?.photoURL ||
          `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(candidateName)}`;

        return {
          id: app.id,
          candidateUid: app.candidateId,
          name: candidateName,
          email: app.candidateEmail || candidateUser?.email || '',
          phone: app.candidatePhone || candidateUser?.phone || candidateUser?.phoneNumber || '',
          avatar,
          title: candidateUser?.headline || job?.title || app.jobTitle || 'Applicant',
          location: candidateUser?.location || job?.location || 'Remote',
          experienceYears: typeof candidateUser?.experienceYears === 'number' ? candidateUser.experienceYears : 0,
          matchScore,
          skills: candidateSkills,
          appliedJobId: app.jobId,
          appliedJobTitle: app.jobTitle || job?.title || 'Open Role',
          stage,
          appliedDate: appDate,
          resumeUrl: app.resumeUrl || candidateUser?.resumeUrl || '#',
          summary: app.coverLetter || candidateUser?.bio || '',
          experienceHistory: expHistory,
          education: eduHistory,
          notes: notesList,
        };
      });
    } catch (err) {
      console.warn('employerPortalService.getCandidates error:', err);
      return [];
    }
  },

  getCandidateDetails: async (candidateId: string): Promise<EmployerCandidate | null> => {
    try {
      const candidates = await employerPortalService.getCandidates();
      const found = candidates.find((c) => c.id === candidateId);
      if (found) return found;

      // Fallback: look up direct application doc
      const app = await applicationRepository.findById(candidateId);
      if (app) {
        const [candidateUser, job] = await Promise.all([
          userRepository.findById(app.candidateId).catch(() => null),
          app.jobId ? jobRepository.findById(app.jobId).catch(() => null) : null,
        ]);

        const stage = mapStatusToStage(app.status);
        const candidateSkills: string[] = Array.isArray(candidateUser?.skills) && candidateUser.skills.length > 0
          ? candidateUser.skills
          : [];

        let matchScore = 0;
        if (job?.skills && job.skills.length > 0 && candidateSkills.length > 0) {
          const jobSkillsLower = job.skills.map((s: string) => s.toLowerCase());
          const matched = candidateSkills.filter((s: string) => jobSkillsLower.includes(s.toLowerCase())).length;
          matchScore = Math.round((matched / job.skills.length) * 100);
        }

        let expHistory: EmployerCandidate['experienceHistory'] = [];
        if (Array.isArray(candidateUser?.experience)) {
          expHistory = candidateUser.experience.map((e: any) => ({
            role: e.role || e.title || 'Role',
            company: e.company || 'Organization',
            duration: e.duration || e.period || '',
            description: e.description || '',
          }));
        }

        let eduHistory: EmployerCandidate['education'] = [];
        if (Array.isArray(candidateUser?.education)) {
          eduHistory = candidateUser.education.map((ed: any) => ({
            degree: ed.degree || 'Degree',
            institution: ed.institution || ed.school || 'Institution',
            year: ed.year || '',
          }));
        } else if (typeof candidateUser?.education === 'string' && candidateUser.education.trim()) {
          eduHistory = [{
            degree: candidateUser.education,
            institution: 'Verified Education',
            year: '',
          }];
        }

        const resolvedCandidateName = resolveCandidateName(candidateUser);
        const candidateName = !resolvedCandidateName.isUnavailable
          ? resolvedCandidateName.name
          : (app.candidateName && isValidCandidateName(app.candidateName) ? app.candidateName.trim() : 'Name unavailable');

        const avatar = candidateUser?.avatarUrl ||
          candidateUser?.photoURL ||
          `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(candidateName)}`;

        return {
          id: app.id,
          candidateUid: app.candidateId,
          name: candidateName,
          email: app.candidateEmail || candidateUser?.email || '',
          phone: app.candidatePhone || candidateUser?.phone || candidateUser?.phoneNumber || '',
          avatar,
          title: candidateUser?.headline || job?.title || app.jobTitle || 'Applicant',
          location: candidateUser?.location || job?.location || 'Remote',
          experienceYears: typeof candidateUser?.experienceYears === 'number' ? candidateUser.experienceYears : 0,
          matchScore,
          skills: candidateSkills,
          appliedJobId: app.jobId,
          appliedJobTitle: app.jobTitle || job?.title || 'Open Role',
          stage,
          appliedDate: typeof app.appliedAt === 'string' ? app.appliedAt.split('T')[0] : 'Recently',
          resumeUrl: app.resumeUrl || candidateUser?.resumeUrl || '#',
          summary: app.coverLetter || candidateUser?.bio || '',
          experienceHistory: expHistory,
          education: eduHistory,
          notes: ((app as any).notes || []).map((n: any, idx: number) =>
            typeof n === 'string' ? { id: `n-${idx}`, author: 'Hiring Team', text: n, createdAt: 'Recently' } : n
          ),
        };
      }
      return null;
    } catch (err) {
      console.warn('employerPortalService.getCandidateDetails error:', err);
      return null;
    }
  },

  updateApplicationStage: async (
    candidateId: string,
    newStage: EmployerCandidate['stage']
  ): Promise<boolean> => {
    if (!isFirebaseConfigured) return true;
    try {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid) return false;
      const employer = await userRepository.findById(currentUid);
      if (!employer || !['employer', 'admin'].includes(employer.role)) return false;

      const app = await applicationRepository.findById(candidateId);
      if (!app || app.employerId !== currentUid) return false;
      const job = await jobRepository.findById(app.jobId);
      if (!job || job.employerId !== currentUid) return false;

      const mappedStatus = mapStageToStatus(newStage);
      if (!isAllowedEmployerTransition(app.status, mappedStatus)) return false;
      await applicationRepository.updateStatus(candidateId, mappedStatus);

      // Notify candidate with canonical route /applications
      const persistedApp = await applicationRepository.findById(candidateId);
      if (persistedApp && persistedApp.candidateId) {
        try {
          await notificationRepository.create({
            userId: persistedApp.candidateId,
            title: 'Application Stage Updated',
            message: `Your application for ${persistedApp.jobTitle} moved to ${newStage}.`,
            type: 'application',
            link: '/applications',
            read: false,
            senderId: currentUid,
            recipientId: persistedApp.candidateId,
            applicationId: persistedApp.id,
            jobId: persistedApp.jobId,
          });
        } catch (notificationError) {
          console.warn('Application status persisted but candidate notification failed:', notificationError);
        }
      }
      return true;
    } catch (err) {
      console.warn('employerPortalService.updateApplicationStage error:', err);
      return false;
    }
  },

  addCandidateNote: async (candidateId: string, noteText: string, authorName: string): Promise<boolean> => {
    if (!isFirebaseConfigured) return true;
    try {
      const appDoc = await applicationRepository.findById(candidateId);
      if (!appDoc) return false;

      const existingNotes = (appDoc as any).notes || [];
      const newNote = {
        id: `note_${Date.now()}`,
        author: authorName,
        text: noteText,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      };

      const docRef = doc(db, 'applications', candidateId);
      await updateDoc(docRef, {
        notes: [...existingNotes, newNote],
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.warn('employerPortalService.addCandidateNote error:', err);
      return false;
    }
  },

  // Interviews
  getInterviews: async (): Promise<ScheduledInterview[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }

    try {
      const interviews = await interviewRepository.findByEmployerId(currentUid);
      return interviews.map((intDoc) => {
        const scheduledDate = intDoc.scheduledAt ? new Date(intDoc.scheduledAt) : new Date();
        return {
          id: intDoc.id,
          candidateId: intDoc.candidateId,
          candidateName: (intDoc as any).candidateName && (intDoc as any).candidateName !== 'Candidate' ? (intDoc as any).candidateName.trim() : 'Name unavailable',
          candidateEmail: (intDoc as any).candidateEmail || '',
          jobId: intDoc.jobId,
          jobTitle: (intDoc as any).jobTitle || 'Technical Role',
          date: scheduledDate.toISOString().split('T')[0],
          time: scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          durationMinutes: intDoc.durationMinutes || 45,
          type: ((intDoc as any).type || 'Technical Round') as ScheduledInterview['type'],
          panelMembers: (intDoc as any).panelMembers || ['Hiring Manager'],
          notes: intDoc.notes || '',
          meetingLink: intDoc.locationOrUrl || 'https://meet.google.com',
          status: (intDoc.status ? intDoc.status.charAt(0).toUpperCase() + intDoc.status.slice(1) : 'Scheduled') as ScheduledInterview['status'],
        };
      });
    } catch (err) {
      console.warn('employerPortalService.getInterviews error:', err);
      return [];
    }
  },

  scheduleInterview: async (
    interviewData: Omit<ScheduledInterview, 'id' | 'status'>
  ): Promise<ScheduledInterview> => {
    const currentUid = auth.currentUser?.uid;
    const now = new Date().toISOString();
    const intId = `int_${Date.now()}`;

    const newInterview: ScheduledInterview = {
      ...interviewData,
      id: intId,
      status: 'Scheduled',
    };

    if (currentUid && isFirebaseConfigured) {
      try {
        const persistedInterview = await interviewRepository.create({
          applicationId: (interviewData as any).applicationId || '',
          jobId: interviewData.jobId,
          candidateId: interviewData.candidateId,
          employerId: currentUid,
          scheduledAt: `${interviewData.date}T${interviewData.time || '10:00'}:00`,
          durationMinutes: interviewData.durationMinutes || 45,
          locationOrUrl: interviewData.meetingLink,
          notes: interviewData.notes,
          status: 'scheduled',
          ...newInterview,
        } as any);

        // Notify candidate
        if (interviewData.candidateId) {
          await notificationRepository.create({
            userId: interviewData.candidateId,
            title: 'Interview Scheduled',
            message: `You have an interview scheduled for ${interviewData.jobTitle} on ${interviewData.date} at ${interviewData.time}.`,
            type: 'interview',
            link: '/interviews',
            read: false,
            senderId: currentUid,
            recipientId: interviewData.candidateId,
            jobId: interviewData.jobId,
          }, `interview_${persistedInterview.id}`);
        }
      } catch (err) {
        console.warn('employerPortalService.scheduleInterview error:', err);
        throw err;
      }
    }

    return newInterview;
  },

  cancelInterview: async (interviewId: string): Promise<boolean> => {
    if (!isFirebaseConfigured) return true;
    try {
      await interviewRepository.update(interviewId, { status: 'cancelled' });
      return true;
    } catch (err) {
      console.warn('employerPortalService.cancelInterview error:', err);
      return false;
    }
  },

  // Offers
  getOffers: async (): Promise<JobOffer[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }

    try {
      const colRef = collection(db, 'offers');
      const q = query(colRef, where('employerId', '==', currentUid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobOffer));
    } catch (err) {
      console.warn('employerPortalService.getOffers error:', err);
      return [];
    }
  },

  createOffer: async (
    offerData: Omit<JobOffer, 'id' | 'sentDate' | 'status' | 'offerLetterUrl'>
  ): Promise<JobOffer> => {
    const currentUid = auth.currentUser?.uid;
    const now = new Date().toISOString().split('T')[0];
    const offerId = `off_${Date.now()}`;

    const newOffer: JobOffer = {
      ...offerData,
      id: offerId,
      sentDate: now,
      status: 'Pending',
      offerLetterUrl: `https://careerconnect.example.com/offers/offer_${Date.now()}.pdf`,
    };

    if (currentUid && isFirebaseConfigured) {
      try {
        const docRef = doc(db, 'offers', offerId);
        await setDoc(docRef, {
          ...newOffer,
          employerId: currentUid,
          createdAt: new Date().toISOString(),
        });

        // Update application stage
        if (offerData.candidateId) {
          await employerPortalService.updateApplicationStage(offerData.candidateId, 'Offer');
        }
      } catch (err) {
        console.warn('employerPortalService.createOffer error:', err);
      }
    }

    return newOffer;
  },

  updateOfferStatus: async (offerId: string, status: JobOffer['status']): Promise<boolean> => {
    if (!isFirebaseConfigured) return true;
    try {
      const docRef = doc(db, 'offers', offerId);
      await updateDoc(docRef, { status, updatedAt: new Date().toISOString() });
      return true;
    } catch (err) {
      console.warn('employerPortalService.updateOfferStatus error:', err);
      return false;
    }
  },

  // Analytics
  getEmployerAnalytics: async (): Promise<EmployerAnalyticsData> => {
    const currentUid = auth.currentUser?.uid;
    const defaultAnalytics: EmployerAnalyticsData = {
      applicationsReceived: 0,
      viewsPerJob: 0,
      avgTimeToHireDays: 14,
      offerAcceptanceRate: 100,
      pipelineConversion: [
        { stage: 'Applied', count: 0 },
        { stage: 'Screening', count: 0 },
        { stage: 'Shortlisted', count: 0 },
        { stage: 'Technical Round', count: 0 },
        { stage: 'Offer', count: 0 },
        { stage: 'Hired', count: 0 },
      ],
      topPerformingJobs: [],
      sourceAttribution: [
        { source: 'CareerConnect Direct', percentage: 70 },
        { source: 'Direct Search', percentage: 30 },
      ],
      monthlyTrend: [
        { month: 'Current', applications: 0, interviews: 0, hires: 0 },
      ],
    };

    if (!currentUid || !isFirebaseConfigured) {
      return defaultAnalytics;
    }

    try {
      const [jobs, applications, interviews, offers] = await Promise.all([
        jobRepository.findByEmployerId(currentUid),
        applicationRepository.findByEmployerId(currentUid),
        interviewRepository.findByEmployerId(currentUid),
        employerPortalService.getOffers(),
      ]);

      const totalApps = applications.length;
      const totalViews = jobs.reduce((acc, j) => acc + (j.viewsCount || 0), 0);
      const viewsPerJob = jobs.length > 0 ? Math.round(totalViews / jobs.length) : 0;

      const stageCounts: Record<string, number> = {
        Applied: 0,
        Screening: 0,
        Shortlisted: 0,
        'Technical Round': 0,
        Offer: 0,
        Hired: 0,
      };

      applications.forEach((app) => {
        const stage = mapStatusToStage(app.status);
        if (stageCounts[stage] !== undefined) {
          stageCounts[stage]++;
        } else {
          stageCounts['Applied']++;
        }
      });

      const pipelineConversion = Object.entries(stageCounts).map(([stage, count]) => ({
        stage,
        count,
      }));

      const topPerformingJobs = jobs.slice(0, 5).map((j) => {
        const jobApps = applications.filter((a) => a.jobId === j.id).length;
        const jobHires = applications.filter((a) => a.jobId === j.id && a.status === 'offered').length;
        return {
          id: j.id,
          title: j.title,
          views: j.viewsCount || 0,
          applications: jobApps,
          hires: jobHires,
        };
      });

      const hiredOffers = offers.filter((o) => o.status === 'Accepted').length;
      const totalOffers = offers.length;
      const offerAcceptanceRate = totalOffers > 0 ? Math.round((hiredOffers / totalOffers) * 100) : 100;

      return {
        applicationsReceived: totalApps,
        viewsPerJob,
        avgTimeToHireDays: 14,
        offerAcceptanceRate,
        pipelineConversion,
        topPerformingJobs,
        sourceAttribution: [
          { source: 'CareerConnect Portal', percentage: 75 },
          { source: 'Direct Application', percentage: 25 },
        ],
        monthlyTrend: [
          { month: 'Recent', applications: totalApps, interviews: interviews.length, hires: hiredOffers },
        ],
      };
    } catch (err) {
      console.warn('employerPortalService.getEmployerAnalytics error:', err);
      return defaultAnalytics;
    }
  },

  // Team Management
  getTeamMembers: async (): Promise<EmployerTeamMember[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }

    try {
      const colRef = collection(db, 'team_members');
      const q = query(colRef, where('employerId', '==', currentUid));
      const snap = await getDocs(q);

      if (!snap.empty) {
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EmployerTeamMember));
      }

      // If none, return current employer user as the owner
      const user = await userRepository.findById(currentUid);
      return [
        {
          id: currentUid,
          name: user?.displayName || auth.currentUser?.displayName || 'Lead Recruiter',
          email: auth.currentUser?.email || '',
          avatar: auth.currentUser?.photoURL || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=160&q=80',
          role: 'Owner',
          department: 'Talent Acquisition',
          status: 'Active',
          permissions: ['Full Admin', 'Job Creation', 'Candidate Evaluation', 'Offer Approval'],
          joinedDate: new Date().toISOString().split('T')[0],
        },
      ];
    } catch (err) {
      console.warn('employerPortalService.getTeamMembers error:', err);
      return [];
    }
  },

  inviteTeamMember: async (
    name: string,
    email: string,
    role: EmployerTeamMember['role']
  ): Promise<EmployerTeamMember> => {
    const currentUid = auth.currentUser?.uid;
    const memberId = `team_${Date.now()}`;
    const newMember: EmployerTeamMember = {
      id: memberId,
      name,
      email,
      avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
      role,
      department: 'Talent Acquisition',
      status: 'Pending Invite',
      permissions: ['Candidate Screening', 'Interview Conducting'],
      joinedDate: new Date().toISOString().split('T')[0],
    };

    if (currentUid && isFirebaseConfigured) {
      try {
        const docRef = doc(db, 'team_members', memberId);
        await setDoc(docRef, {
          ...newMember,
          employerId: currentUid,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('employerPortalService.inviteTeamMember error:', err);
      }
    }

    return newMember;
  },

  removeTeamMember: async (id: string): Promise<boolean> => {
    if (!isFirebaseConfigured) return true;
    try {
      const docRef = doc(db, 'team_members', id);
      await deleteDoc(docRef);
      return true;
    } catch (err) {
      console.warn('employerPortalService.removeTeamMember error:', err);
      return false;
    }
  },

  // Notifications
  getNotifications: async (): Promise<EmployerNotification[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }

    try {
      const notifs = await notificationRepository.findByUserId(currentUid);
      return notifs.map((n) => {
        let category: EmployerNotification['category'] = 'system';
        if (n.type === 'application') category = 'application';
        else if (n.type === 'interview') category = 'interview';

        return {
          id: n.id,
          title: n.title,
          message: n.message,
          timestamp: formatRelativeTime(n.createdAt),
          category,
          read: n.read,
          link: n.link || '/employer/candidates',
        };
      });
    } catch (err) {
      console.warn('employerPortalService.getNotifications error:', err);
      return [];
    }
  },

  // Hiring Campaigns
  getCampaigns: async (): Promise<HiringCampaign[]> => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid || !isFirebaseConfigured) {
      return [];
    }
    try {
      const docs = await hiringCampaignRepository.findByEmployerId(currentUid);
      return docs.map((d) => ({
        id: d.id,
        employerId: d.employerId,
        companyId: d.companyId,
        companyName: d.companyName,
        companyLogo: d.companyLogo,
        title: d.title,
        description: d.description,
        positions: d.positions || [],
        requiredSkills: d.requiredSkills || [],
        experienceLevel: d.experienceLevel || 'Mid Level',
        location: d.location || 'Remote',
        workMode: (d.workMode as any) || 'Remote',
        employmentType: (d.employmentType as any) || 'Full-time',
        applicationDestination: d.applicationDestination || '',
        status: (d.status as any) || 'active',
        startDate: d.startDate,
        endDate: d.endDate,
        applicantCount: d.applicantCount || 0,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(d.createdAt).toISOString(),
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(d.updatedAt).toISOString(),
      }));
    } catch (err) {
      console.warn('employerPortalService.getCampaigns error:', err);
      return [];
    }
  },

  createCampaign: async (campaignData: Omit<HiringCampaign, 'id' | 'createdAt' | 'updatedAt'>): Promise<HiringCampaign> => {
    const currentUid = auth.currentUser?.uid;
    const campaignId = `camp_${Date.now()}`;
    const now = new Date().toISOString();

    const newCamp: HiringCampaign = {
      ...campaignData,
      id: campaignId,
      employerId: currentUid || campaignData.employerId,
      createdAt: now,
      updatedAt: now,
    };

    if (currentUid && isFirebaseConfigured) {
      try {
        await hiringCampaignRepository.create(newCamp);
      } catch (err) {
        console.warn('employerPortalService.createCampaign error:', err);
      }
    }
    return newCamp;
  },

  updateCampaign: async (id: string, updates: Partial<HiringCampaign>): Promise<void> => {
    if (!isFirebaseConfigured) return;
    try {
      await hiringCampaignRepository.update(id, updates);
    } catch (err) {
      console.warn('employerPortalService.updateCampaign error:', err);
    }
  },

  deleteCampaign: async (id: string): Promise<void> => {
    if (!isFirebaseConfigured) return;
    try {
      await hiringCampaignRepository.delete(id);
    } catch (err) {
      console.warn('employerPortalService.deleteCampaign error:', err);
    }
  },

  listActiveCampaigns: async (limitCount: number = 20): Promise<HiringCampaign[]> => {
    if (!isFirebaseConfigured) return [];
    try {
      const docs = await hiringCampaignRepository.listActive(limitCount);
      return docs.map((d) => ({
        id: d.id,
        employerId: d.employerId,
        companyId: d.companyId,
        companyName: d.companyName,
        companyLogo: d.companyLogo,
        title: d.title,
        description: d.description,
        positions: d.positions || [],
        requiredSkills: d.requiredSkills || [],
        experienceLevel: d.experienceLevel || 'Mid Level',
        location: d.location || 'Remote',
        workMode: (d.workMode as any) || 'Remote',
        employmentType: (d.employmentType as any) || 'Full-time',
        applicationDestination: d.applicationDestination || '',
        status: (d.status as any) || 'active',
        startDate: d.startDate,
        endDate: d.endDate,
        applicantCount: d.applicantCount || 0,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(d.createdAt).toISOString(),
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(d.updatedAt).toISOString(),
      }));
    } catch (err) {
      console.warn('employerPortalService.listActiveCampaigns error:', err);
      return [];
    }
  },
};
