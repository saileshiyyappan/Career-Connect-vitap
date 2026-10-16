import React, { useState, useEffect } from 'react';
import { PageContainer } from '../../components/common/PageContainer';
import { SectionHeader } from '../../components/common/SectionHeader';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { SecondaryButton } from '../../components/common/SecondaryButton';
import { Badge } from '../../components/common/Badge';
import { InputField } from '../../components/inputs/InputField';
import { SelectInput } from '../../components/inputs/SelectInput';
import { TextareaInput } from '../../components/inputs/TextareaInput';
import { employerPortalService, ScheduledInterview, EmployerCandidate } from '../../services/employerPortalService';
import { useJobContext } from '../../context/JobContext';
import {
  Calendar,
  Clock,
  Video,
  PlusCircle,
  User,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Users,
  AlertCircle
} from 'lucide-react';

export const EmployerInterviewsPage: React.FC = () => {
  const { jobs } = useJobContext();
  const [interviews, setInterviews] = useState<ScheduledInterview[]>([]);
  const [candidates, setCandidates] = useState<EmployerCandidate[]>([]);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

  // Form State
  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('10:00 AM');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [type, setType] = useState<ScheduledInterview['type']>('Technical Round');
  const [panelInput, setPanelInput] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    employerPortalService.getInterviews().then(setInterviews);
    employerPortalService.getCandidates().then(setCandidates);
  }, []);

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cand = candidates.find(c => c.id === candidateId);
    const job = jobs.find(j => j.id === jobId);

    if (!cand || !job) {
      alert('Please select a valid candidate and job opening to schedule.');
      return;
    }

    setIsSubmitting(true);
    const newInt = await employerPortalService.scheduleInterview({
      // Candidate cards are keyed by application id for status updates;
      // interview authorization requires the candidate's users/{uid} id.
      candidateId: cand.candidateUid,
      candidateName: cand.name,
      candidateEmail: cand.email,
      jobId: job.id,
      jobTitle: job.title,
      date,
      time,
      durationMinutes,
      type,
      panelMembers: panelInput.trim() ? [panelInput.trim()] : ['Hiring Team'],
      notes,
      meetingLink: `https://meet.careerconnect.dev/room/interview-${Date.now()}`
    });

    setInterviews([newInt, ...interviews]);
    setIsSubmitting(false);
    setIsScheduleModalOpen(false);
  };

  const handleCancelInterview = async (id: string) => {
    await employerPortalService.cancelInterview(id);
    setInterviews(prev => prev.map(i => i.id === id ? { ...i, status: 'Cancelled' } : i));
  };

  return (
    <PageContainer className="py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <SectionHeader
          title="Interview Scheduler & Management"
          subtitle="Schedule screening calls, live technical pairings, and panel interviews with video links."
          badge="Interviewer Suite"
        />

        <PrimaryButton icon={PlusCircle} onClick={() => setIsScheduleModalOpen(true)}>
          Schedule New Interview
        </PrimaryButton>
      </div>

      {/* Interviews List Grid */}
      <div className="space-y-4">
        {interviews.map((interview) => (
          <div
            key={interview.id}
            className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 hover:shadow-md transition-all"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {interview.candidateName}
                  </h4>
                  <Badge variant={interview.status === 'Scheduled' ? 'success' : 'secondary'} size="sm">
                    {interview.status}
                  </Badge>
                  <Badge variant="info" size="sm">{interview.type}</Badge>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  Position: <strong className="text-slate-700 dark:text-slate-300">{interview.jobTitle}</strong> ({interview.candidateEmail})
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span>{interview.date} at {interview.time} ({interview.durationMinutes} mins)</span>
              </div>
            </div>

            {/* Video Link & Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-bold text-blue-900 dark:text-blue-200">Video Room Link:</span>
                </div>
                <a
                  href={interview.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded-xl bg-blue-600 text-white font-bold flex items-center gap-1 hover:bg-blue-700 transition-colors"
                >
                  Join Room <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Panel: {interview.panelMembers.join(', ')}
                </span>
              </div>
            </div>

            {interview.notes && (
              <p className="text-xs text-slate-500 italic bg-slate-50 dark:bg-slate-800/30 p-3 rounded-xl">
                Notes: "{interview.notes}"
              </p>
            )}

            {interview.status === 'Scheduled' && (
              <div className="pt-2 flex justify-end gap-2">
                <SecondaryButton size="sm" onClick={() => handleCancelInterview(interview.id)}>
                  Cancel Interview
                </SecondaryButton>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Schedule Modal */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleScheduleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Schedule Candidate Interview
              </h3>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer text-lg font-bold"
              >
                ×
              </button>
            </div>

            <SelectInput
              label="Select Candidate"
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              options={candidates.map(c => ({ value: c.id, label: `${c.name} (${c.title})` }))}
            />

            <SelectInput
              label="Job Position"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              options={jobs.map(j => ({ value: j.id, label: j.title }))}
            />

            <div className="grid grid-cols-2 gap-4">
              <InputField label="Interview Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <InputField label="Time (e.g. 14:00 PST)" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>

            <SelectInput
              label="Interview Stage / Type"
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              options={[
                { value: 'Screening', label: 'Screening Call (30 mins)' },
                { value: 'Technical Round', label: 'Technical Pair Coding (60 mins)' },
                { value: 'System Design', label: 'System Architecture (60 mins)' },
                { value: 'HR & Culture', label: 'HR & Executive Culture (45 mins)' },
              ]}
            />

            <InputField label="Interviewer Panel Member(s)" value={panelInput} onChange={(e) => setPanelInput(e.target.value)} />
            <TextareaInput label="Interview Prep Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
              <SecondaryButton type="button" onClick={() => setIsScheduleModalOpen(false)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" isLoading={isSubmitting} icon={Calendar}>
                Confirm & Send Invite
              </PrimaryButton>
            </div>
          </form>
        </div>
      )}
    </PageContainer>
  );
};
