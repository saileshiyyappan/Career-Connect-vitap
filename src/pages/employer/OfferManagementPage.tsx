import React, { useState, useEffect } from 'react';
import { PageContainer } from '../../components/common/PageContainer';
import { SectionHeader } from '../../components/common/SectionHeader';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { SecondaryButton } from '../../components/common/SecondaryButton';
import { InputField } from '../../components/inputs/InputField';
import { SelectInput } from '../../components/inputs/SelectInput';
import { TextareaInput } from '../../components/inputs/TextareaInput';
import { OfferCard } from '../../components/cards/OfferCard';
import { employerPortalService, JobOffer, EmployerCandidate } from '../../services/employerPortalService';
import { useJobContext } from '../../context/JobContext';
import { Gift, PlusCircle, CheckCircle2, Download } from 'lucide-react';

export const OfferManagementPage: React.FC = () => {
  const { jobs } = useJobContext();
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [candidates, setCandidates] = useState<EmployerCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Form State
  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [signingBonus, setSigningBonus] = useState('');
  const [equity, setEquity] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [expirationDate, setExpirationDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    employerPortalService.getOffers().then(setOffers);
    employerPortalService.getCandidates().then(setCandidates);
  }, []);

  const handleUpdateStatus = async (offerId: string, status: JobOffer['status']) => {
    await employerPortalService.updateOfferStatus(offerId, status);
    setOffers(prev => prev.map(o => o.id === offerId ? { ...o, status } : o));
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    const cand = candidates.find(c => c.id === candidateId);
    const job = jobs.find(j => j.id === jobId);

    if (!cand || !job) {
      alert('Please select a valid candidate and job opening.');
      return;
    }

    setIsSubmitting(true);
    const newOffer = await employerPortalService.createOffer({
      candidateId: cand.candidateUid,
      candidateName: cand.name,
      candidateEmail: cand.email,
      jobId: job.id,
      jobTitle: job.title,
      baseSalary: parseInt(baseSalary, 10) || 0,
      signingBonus: parseInt(signingBonus, 10) || 0,
      equity: equity.trim() || 'N/A',
      startDate,
      expirationDate,
    });

    setOffers([newOffer, ...offers]);
    setIsSubmitting(false);
    setIsOfferModalOpen(false);
    setSuccessMsg(`Official offer letter sent to ${cand.name}!`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleDownloadPdf = (offer: JobOffer) => {
    alert(`Downloading formal employment offer letter for ${offer.candidateName} (${offer.jobTitle})...`);
  };

  const filteredOffers = statusFilter === 'all'
    ? offers
    : offers.filter(o => o.status === statusFilter);

  return (
    <PageContainer className="py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <SectionHeader
          title="Formal Offer Management & Packages"
          subtitle="Generate, send, track, and manage official employment contracts and compensation packages."
          badge="Offer Center"
        />

        <PrimaryButton icon={PlusCircle} onClick={() => setIsOfferModalOpen(true)}>
          Generate Offer Letter
        </PrimaryButton>
      </div>

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          {successMsg}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: 'all', label: 'All Offers' },
          { id: 'Pending', label: 'Pending Response' },
          { id: 'Accepted', label: 'Accepted Contracts' },
          { id: 'Rejected', label: 'Declined' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === tab.id
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Offers Cards List */}
      <div className="space-y-4">
        {filteredOffers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onUpdateStatus={handleUpdateStatus}
            onDownloadPdf={handleDownloadPdf}
          />
        ))}
      </div>

      {/* Generate Offer Modal */}
      {isOfferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateOffer} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Generate Official Job Offer Package
              </h3>
              <button
                type="button"
                onClick={() => setIsOfferModalOpen(false)}
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
              <InputField label="Base Annual Salary (USD)" type="number" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} />
              <InputField label="Signing Bonus (USD)" type="number" value={signingBonus} onChange={(e) => setSigningBonus(e.target.value)} />
            </div>

            <InputField label="Stock Equity / Incentive Units" value={equity} onChange={(e) => setEquity(e.target.value)} />

            <div className="grid grid-cols-2 gap-4">
              <InputField label="Target Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <InputField label="Offer Expiration Date" type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
              <SecondaryButton type="button" onClick={() => setIsOfferModalOpen(false)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" isLoading={isSubmitting} icon={Gift}>
                Issue & Send Offer Contract
              </PrimaryButton>
            </div>
          </form>
        </div>
      )}
    </PageContainer>
  );
};
