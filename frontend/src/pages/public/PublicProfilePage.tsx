import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { MapPin, Phone, Clock, Dumbbell, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@services/api';

interface Trainer {
  id: string;
  name: string;
  specialty: string;
  photoUrl?: string;
}

interface GymProfile {
  name: string;
  description?: string;
  address: string;
  city?: string;
  state?: string;
  phone: string;
  email?: string;
  timings?: string;
  facilities?: string[];
  coverImage?: string;
  logo?: string;
  latitude?: number;
  longitude?: number;
  trainers: Trainer[];
  stats?: { memberCount: number; trainerCount: number; batchCount: number };
}

interface EnquiryForm {
  name: string;
  phone: string;
  email?: string;
  message?: string;
}

export function PublicProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<GymProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, reset } = useForm<EnquiryForm>();

  useEffect(() => {
    (async () => {
      try {
        const res: any = await api.get(`/public/${slug}`);
        const { gym, trainers, stats } = res.data ?? {};
        if (gym) {
          setProfile({
            name: gym.name,
            description: gym.description,
            address: [gym.address, gym.city, gym.state].filter(Boolean).join(', '),
            phone: gym.phone,
            email: gym.email,
            timings: gym.timings,
            facilities: gym.facilities ?? [],
            coverImage: gym.coverImage,
            logo: gym.logo,
            latitude: gym.latitude,
            longitude: gym.longitude,
            trainers: (trainers ?? []).map((t: any) => ({
              id: t.id,
              name: `${t.firstName} ${t.lastName}`,
              specialty: 'Trainer',
              photoUrl: t.avatar,
            })),
            stats,
          });
          document.title = `${gym.name} | MuscleOS`;
        } else {
          setProfile(null);
        }
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const onEnquire = async (data: EnquiryForm) => {
    try {
      await api.post(`/public/${slug}/enquiry`, data);
      setSubmitted(true);
      reset();
    } catch {
      // keep form data if it fails so user can retry
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <Dumbbell className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium">Gym profile not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl px-4 py-6 flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Dumbbell className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            {profile.stats && (
              <p className="text-sm text-muted-foreground">
                {profile.stats.memberCount} members • {profile.stats.trainerCount} trainers •{' '}
                {profile.stats.batchCount} batches
              </p>
            )}
          </div>
        </div>
      </header>

      {profile.coverImage && (
        <img
          src={profile.coverImage}
          alt={`${profile.name} facility`}
          className="h-56 w-full object-cover"
          loading="lazy"
        />
      )}

      <main className="mx-auto max-w-5xl px-4 py-8 grid gap-8 md:grid-cols-3">
        <div className="md:col-span-2 space-y-8">
          {profile.description && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h2 className="text-xl font-semibold mb-2">About</h2>
              <p className="text-muted-foreground">{profile.description}</p>
            </motion.section>
          )}

          {profile.facilities && profile.facilities.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Facilities</h2>
              <div className="grid grid-cols-2 gap-2">
                {profile.facilities.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {f}
                  </div>
                ))}
              </div>
            </section>
          )}

          {profile.trainers && profile.trainers.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Our Trainers</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {profile.trainers.map((t) => (
                  <div key={t.id} className="text-center">
                    <div className="h-20 w-20 mx-auto rounded-full bg-muted overflow-hidden mb-2">
                      {t.photoUrl && (
                        <img src={t.photoUrl} alt={t.name} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.specialty}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {profile.latitude && profile.longitude && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Location</h2>
              <iframe
                title="gym-location"
                className="w-full h-64 rounded-md border"
                loading="lazy"
                src={`https://maps.google.com/maps?q=${profile.latitude},${profile.longitude}&z=15&output=embed`}
              />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <span>{profile.address}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{profile.phone}</span>
            </div>
            {profile.timings && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{profile.timings}</span>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold mb-3">Membership Enquiry</h3>
            {submitted ? (
              <p className="text-sm text-green-600">
                Thanks! Our team will contact you shortly.
              </p>
            ) : (
              <form onSubmit={handleSubmit(onEnquire)} className="space-y-3">
                <input
                  {...register('name', { required: true })}
                  placeholder="Your name"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <input
                  {...register('phone', { required: true })}
                  placeholder="Phone number"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <input
                  {...register('email')}
                  placeholder="Email (optional)"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <textarea
                  {...register('message')}
                  placeholder="I'm interested in..."
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button type="submit" className="w-full">
                  Send Enquiry
                </Button>
              </form>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
