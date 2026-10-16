/**
 * Canonical User Profile & Name Normalization Utilities
 *
 * Provides a single, authoritative source of truth for:
 * - Validating genuine user/candidate names against placeholders
 * - Resolving candidate & user display names across all schema variants
 * - Consolidating legacy/inconsistent profile fields into canonical users/{uid} format
 * - Generating dry-run migration audits for existing Firestore records
 */

import { FirestoreUserDocument } from '../firebase/types';

/**
 * Placeholders and sentinel values that do NOT constitute authentic human names.
 */
export const INVALID_NAME_PLACEHOLDERS = new Set<string>([
  'undefined',
  'null',
  'candidate',
  'job candidate',
  'job seeker',
  'applicant',
  'user',
  'guest',
  'guest user',
  'name unavailable',
  'n/a',
  'na',
  'none',
  'unknown',
  'test',
  'test user',
]);

/**
 * Validates whether a value is a genuine, non-empty, non-placeholder name string.
 */
export function isValidCandidateName(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !INVALID_NAME_PLACEHOLDERS.has(lower);
}

export interface ResolvedNameResult {
  name: string;
  isUnavailable: boolean;
  sourceField?: string;
}

/**
 * Resolves the genuine stored name for any user or candidate entity.
 *
 * Deterministic precedence:
 * 1. Direct canonical `displayName`
 * 2. Direct canonical `fullName`
 * 3. Direct canonical `name`
 * 4. Combined non-empty `firstName` and `lastName` (or `first_name`/`last_name`)
 * 5. Single non-empty `firstName` or `lastName`
 * 6. Nested `profile` object (displayName, fullName, name, firstName + lastName)
 * 7. Nested `personalInfo` or `basicInfo` objects
 * 8. Fallback: "Name unavailable" (never infer or fabricate from email)
 */
export function resolveCandidateName(u: any): ResolvedNameResult {
  if (!u) {
    return { name: 'Name unavailable', isUnavailable: true };
  }

  // 1. Direct canonical displayName
  if (isValidCandidateName(u.displayName)) {
    return { name: u.displayName.trim(), isUnavailable: false, sourceField: 'displayName' };
  }

  // 2. Direct canonical fullName
  if (isValidCandidateName(u.fullName)) {
    return { name: u.fullName.trim(), isUnavailable: false, sourceField: 'fullName' };
  }

  // 3. Direct canonical name
  if (isValidCandidateName(u.name)) {
    return { name: u.name.trim(), isUnavailable: false, sourceField: 'name' };
  }

  // 4. Combined non-empty firstName and lastName
  const fName = typeof u.firstName === 'string'
    ? u.firstName.trim()
    : typeof u.first_name === 'string'
    ? u.first_name.trim()
    : '';
  const lName = typeof u.lastName === 'string'
    ? u.lastName.trim()
    : typeof u.last_name === 'string'
    ? u.last_name.trim()
    : '';

  const combined = `${fName} ${lName}`.trim();
  if (isValidCandidateName(combined)) {
    return { name: combined, isUnavailable: false, sourceField: 'firstName+lastName' };
  }

  // 5. Individual non-empty firstName or lastName if only one was recorded
  if (isValidCandidateName(fName)) {
    return { name: fName, isUnavailable: false, sourceField: 'firstName' };
  }
  if (isValidCandidateName(lName)) {
    return { name: lName, isUnavailable: false, sourceField: 'lastName' };
  }

  // 6. Nested profile object if present
  if (u.profile && typeof u.profile === 'object') {
    if (isValidCandidateName(u.profile.displayName)) {
      return { name: u.profile.displayName.trim(), isUnavailable: false, sourceField: 'profile.displayName' };
    }
    if (isValidCandidateName(u.profile.fullName)) {
      return { name: u.profile.fullName.trim(), isUnavailable: false, sourceField: 'profile.fullName' };
    }
    if (isValidCandidateName(u.profile.name)) {
      return { name: u.profile.name.trim(), isUnavailable: false, sourceField: 'profile.name' };
    }
    const pfName = typeof u.profile.firstName === 'string'
      ? u.profile.firstName.trim()
      : typeof u.profile.first_name === 'string'
      ? u.profile.first_name.trim()
      : '';
    const plName = typeof u.profile.lastName === 'string'
      ? u.profile.lastName.trim()
      : typeof u.profile.last_name === 'string'
      ? u.profile.last_name.trim()
      : '';
    const pCombined = `${pfName} ${plName}`.trim();
    if (isValidCandidateName(pCombined)) {
      return { name: pCombined, isUnavailable: false, sourceField: 'profile.firstName+lastName' };
    }
    if (isValidCandidateName(pfName)) return { name: pfName, isUnavailable: false, sourceField: 'profile.firstName' };
    if (isValidCandidateName(plName)) return { name: plName, isUnavailable: false, sourceField: 'profile.lastName' };
  }

  // 7. Nested personalInfo or basicInfo objects if present
  if (u.personalInfo && typeof u.personalInfo === 'object') {
    if (isValidCandidateName(u.personalInfo.fullName)) {
      return { name: u.personalInfo.fullName.trim(), isUnavailable: false, sourceField: 'personalInfo.fullName' };
    }
    if (isValidCandidateName(u.personalInfo.name)) {
      return { name: u.personalInfo.name.trim(), isUnavailable: false, sourceField: 'personalInfo.name' };
    }
    if (isValidCandidateName(u.personalInfo.displayName)) {
      return { name: u.personalInfo.displayName.trim(), isUnavailable: false, sourceField: 'personalInfo.displayName' };
    }
    const pifName = typeof u.personalInfo.firstName === 'string' ? u.personalInfo.firstName.trim() : '';
    const pilName = typeof u.personalInfo.lastName === 'string' ? u.personalInfo.lastName.trim() : '';
    const piCombined = `${pifName} ${pilName}`.trim();
    if (isValidCandidateName(piCombined)) {
      return { name: piCombined, isUnavailable: false, sourceField: 'personalInfo.firstName+lastName' };
    }
  }

  if (u.basicInfo && typeof u.basicInfo === 'object') {
    if (isValidCandidateName(u.basicInfo.fullName)) {
      return { name: u.basicInfo.fullName.trim(), isUnavailable: false, sourceField: 'basicInfo.fullName' };
    }
    if (isValidCandidateName(u.basicInfo.name)) {
      return { name: u.basicInfo.name.trim(), isUnavailable: false, sourceField: 'basicInfo.name' };
    }
    if (isValidCandidateName(u.basicInfo.displayName)) {
      return { name: u.basicInfo.displayName.trim(), isUnavailable: false, sourceField: 'basicInfo.displayName' };
    }
    const bifName = typeof u.basicInfo.firstName === 'string'
      ? u.basicInfo.firstName.trim()
      : typeof u.basicInfo.first_name === 'string'
      ? u.basicInfo.first_name.trim()
      : '';
    const bilName = typeof u.basicInfo.lastName === 'string'
      ? u.basicInfo.lastName.trim()
      : typeof u.basicInfo.last_name === 'string'
      ? u.basicInfo.last_name.trim()
      : '';
    const biCombined = `${bifName} ${bilName}`.trim();
    if (isValidCandidateName(biCombined)) {
      return { name: biCombined, isUnavailable: false, sourceField: 'basicInfo.firstName+lastName' };
    }
    if (isValidCandidateName(bifName)) return { name: bifName, isUnavailable: false, sourceField: 'basicInfo.firstName' };
    if (isValidCandidateName(bilName)) return { name: bilName, isUnavailable: false, sourceField: 'basicInfo.lastName' };
  }

  // 8. No genuine stored name found
  return { name: 'Name unavailable', isUnavailable: true };
}

/**
 * Splits a full name string into canonical [firstName, lastName] parts safely.
 */
export function splitCanonicalName(fullName: string): { firstName: string; lastName: string } {
  if (!isValidCandidateName(fullName)) {
    return { firstName: '', lastName: '' };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export interface CanonicalUserProfileConsolidation {
  uid: string;
  email: string;
  role: 'job_seeker' | 'candidate' | 'employer' | 'admin';
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  headline?: string;
  bio?: string;
  skills: string[];
  education?: string | any[];
  experience?: any[];
  experienceYears?: number;
  location?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  resumeUrl?: string;
  resumeName?: string;
  resumeUpdatedAt?: string;
  phone?: string;
  phoneNumber?: string;
  accountStatus: 'active' | 'suspended' | 'pending';
  profileCompleted: boolean;
  emailVerified: boolean;
  createdAt: string | number;
  updatedAt: string | number;
  // Employer credentials if applicable
  employerPosition?: string;
  department?: string;
  professionalTitle?: string;
  companyName?: string;
  companyWebsite?: string;
}

/**
 * Consolidates any raw user document into the authoritative canonical schema for users/{uid}.
 * Does not overwrite genuine information, preserves all legitimate fields,
 * and normalizes aliased/duplicate properties (e.g. photoURL -> avatarUrl, phone -> phoneNumber).
 */
export function consolidateRawUserDoc(rawDoc: any): CanonicalUserProfileConsolidation {
  const uid = rawDoc.uid || rawDoc.id;
  const email = rawDoc.email || '';
  const role = (rawDoc.role === 'candidate' ? 'candidate' : rawDoc.role) || 'job_seeker';

  const nameRes = resolveCandidateName(rawDoc);
  let displayName = !nameRes.isUnavailable ? nameRes.name : undefined;

  let firstName = typeof rawDoc.firstName === 'string' && rawDoc.firstName.trim()
    ? rawDoc.firstName.trim()
    : undefined;
  let lastName = typeof rawDoc.lastName === 'string' && rawDoc.lastName.trim()
    ? rawDoc.lastName.trim()
    : undefined;

  if (displayName && (!firstName || !lastName)) {
    const split = splitCanonicalName(displayName);
    if (!firstName && split.firstName) firstName = split.firstName;
    if (!lastName && split.lastName) lastName = split.lastName;
  }

  // Avatar normalization (prefer avatarUrl, fallback to photoURL)
  const avatarUrl = (rawDoc.avatarUrl && typeof rawDoc.avatarUrl === 'string' && rawDoc.avatarUrl.trim())
    ? rawDoc.avatarUrl.trim()
    : (rawDoc.photoURL && typeof rawDoc.photoURL === 'string' && rawDoc.photoURL.trim())
    ? rawDoc.photoURL.trim()
    : undefined;

  // Phone normalization
  const phone = (rawDoc.phone && typeof rawDoc.phone === 'string' && rawDoc.phone.trim())
    ? rawDoc.phone.trim()
    : (rawDoc.phoneNumber && typeof rawDoc.phoneNumber === 'string' && rawDoc.phoneNumber.trim())
    ? rawDoc.phoneNumber.trim()
    : undefined;

  // Portfolio normalization (prefer portfolioUrl, fallback to website)
  const portfolioUrl = (rawDoc.portfolioUrl && typeof rawDoc.portfolioUrl === 'string' && rawDoc.portfolioUrl.trim())
    ? rawDoc.portfolioUrl.trim()
    : (rawDoc.website && typeof rawDoc.website === 'string' && rawDoc.website.trim())
    ? rawDoc.website.trim()
    : undefined;

  // Skills normalization (array of clean strings)
  const skills: string[] = Array.isArray(rawDoc.skills)
    ? Array.from(new Set(rawDoc.skills.map((s: any) => String(s || '').trim()).filter(Boolean)))
    : [];

  const headline = rawDoc.headline || '';
  const bio = rawDoc.bio || '';
  const location = rawDoc.location || '';
  const experienceYears = typeof rawDoc.experienceYears === 'number'
    ? rawDoc.experienceYears
    : typeof rawDoc.experienceYears === 'string'
    ? parseInt(rawDoc.experienceYears, 10) || 0
    : 0;

  const accountStatus: 'active' | 'suspended' | 'pending' =
    rawDoc.accountStatus === 'suspended' || rawDoc.status === 'suspended'
      ? 'suspended'
      : rawDoc.accountStatus === 'pending'
      ? 'pending'
      : 'active';

  const now = new Date().toISOString();
  const createdAt = rawDoc.createdAt || now;
  const updatedAt = rawDoc.updatedAt || now;

  return {
    uid,
    email,
    role,
    ...(displayName ? { displayName } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    headline,
    bio,
    skills,
    ...(rawDoc.education !== undefined ? { education: rawDoc.education } : {}),
    ...(rawDoc.experience !== undefined ? { experience: rawDoc.experience } : {}),
    experienceYears,
    location,
    ...(portfolioUrl ? { portfolioUrl } : {}),
    ...(rawDoc.githubUrl ? { githubUrl: String(rawDoc.githubUrl).trim() } : {}),
    ...(rawDoc.linkedinUrl ? { linkedinUrl: String(rawDoc.linkedinUrl).trim() } : {}),
    ...(rawDoc.resumeUrl ? { resumeUrl: String(rawDoc.resumeUrl).trim() } : {}),
    ...(rawDoc.resumeName ? { resumeName: String(rawDoc.resumeName).trim() } : {}),
    ...(rawDoc.resumeUpdatedAt ? { resumeUpdatedAt: rawDoc.resumeUpdatedAt } : {}),
    ...(phone ? { phone, phoneNumber: phone } : {}),
    accountStatus,
    profileCompleted: rawDoc.profileCompleted ?? true,
    emailVerified: rawDoc.emailVerified ?? false,
    createdAt,
    updatedAt,
    ...(role === 'employer' ? {
      ...(rawDoc.employerPosition ? { employerPosition: rawDoc.employerPosition } : {}),
      ...(rawDoc.department ? { department: rawDoc.department } : {}),
      ...(rawDoc.professionalTitle ? { professionalTitle: rawDoc.professionalTitle } : {}),
      ...(rawDoc.companyName ? { companyName: rawDoc.companyName } : {}),
      ...(rawDoc.companyWebsite ? { companyWebsite: rawDoc.companyWebsite } : {}),
    } : {}),
  };
}

export interface UserMigrationRecordAudit {
  uid: string;
  email: string;
  originalRole?: string;
  resolvedName: string;
  nameSourceField?: string;
  fieldsModified: string[];
  fieldsPreserved: string[];
  conflictsDetected: string[];
  proposedUpdates: Record<string, any>;
}

export interface MigrationDryRunReport {
  timestamp: string;
  totalDocumentsScanned: number;
  documentsNeedingConsolidation: number;
  documentsAlreadyCanonical: number;
  accountsWithGenuineNames: number;
  accountsWithNameUnavailable: number;
  detailedAudits: UserMigrationRecordAudit[];
}

/**
 * Creates an idempotent, non-destructive migration audit dry-run for a list of Firestore user documents.
 * Evaluates what fields would be updated without writing to production.
 */
export function auditAndDryRunUserMigration(docs: any[]): MigrationDryRunReport {
  const audits: UserMigrationRecordAudit[] = [];
  let needingConsolidation = 0;
  let alreadyCanonical = 0;
  let genuineNamesCount = 0;
  let unavailableNamesCount = 0;

  for (const doc of docs) {
    const raw = { ...doc };
    const uid = raw.uid || raw.id;
    const consolidated = consolidateRawUserDoc(raw);
    const resolvedName = resolveCandidateName(raw);

    if (!resolvedName.isUnavailable) {
      genuineNamesCount++;
    } else {
      unavailableNamesCount++;
    }

    const modifiedFields: string[] = [];
    const preservedFields: string[] = [];
    const conflicts: string[] = [];
    const proposedUpdates: Record<string, any> = {};

    // Check name consolidation
    if (consolidated.displayName && raw.displayName !== consolidated.displayName) {
      modifiedFields.push('displayName');
      proposedUpdates.displayName = consolidated.displayName;
      if (raw.displayName && raw.displayName !== consolidated.displayName) {
        conflicts.push(`displayName conflict: original "${raw.displayName}" vs resolved "${consolidated.displayName}"`);
      }
    } else {
      preservedFields.push('displayName');
    }

    // Check firstName / lastName
    if (consolidated.firstName && raw.firstName !== consolidated.firstName) {
      modifiedFields.push('firstName');
      proposedUpdates.firstName = consolidated.firstName;
    }
    if (consolidated.lastName && raw.lastName !== consolidated.lastName) {
      modifiedFields.push('lastName');
      proposedUpdates.lastName = consolidated.lastName;
    }

    // Check avatarUrl / photoURL alias
    if (consolidated.avatarUrl && !raw.avatarUrl && raw.photoURL) {
      modifiedFields.push('avatarUrl (promoted from photoURL)');
      proposedUpdates.avatarUrl = consolidated.avatarUrl;
    }

    // Check phone / phoneNumber alias
    if (consolidated.phone && !raw.phone && raw.phoneNumber) {
      modifiedFields.push('phone (mirrored from phoneNumber)');
      proposedUpdates.phone = consolidated.phone;
    }
    if (consolidated.phoneNumber && !raw.phoneNumber && raw.phone) {
      modifiedFields.push('phoneNumber (mirrored from phone)');
      proposedUpdates.phoneNumber = consolidated.phoneNumber;
    }

    // Check portfolioUrl / website alias
    if (consolidated.portfolioUrl && !raw.portfolioUrl && raw.website) {
      modifiedFields.push('portfolioUrl (promoted from website)');
      proposedUpdates.portfolioUrl = consolidated.portfolioUrl;
    }

    if (modifiedFields.length > 0) {
      needingConsolidation++;
    } else {
      alreadyCanonical++;
    }

    audits.push({
      uid,
      email: raw.email || '',
      originalRole: raw.role,
      resolvedName: resolvedName.name,
      nameSourceField: resolvedName.sourceField,
      fieldsModified: modifiedFields,
      fieldsPreserved: preservedFields,
      conflictsDetected: conflicts,
      proposedUpdates,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    totalDocumentsScanned: docs.length,
    documentsNeedingConsolidation: needingConsolidation,
    documentsAlreadyCanonical: alreadyCanonical,
    accountsWithGenuineNames: genuineNamesCount,
    accountsWithNameUnavailable: unavailableNamesCount,
    detailedAudits: audits,
  };
}
