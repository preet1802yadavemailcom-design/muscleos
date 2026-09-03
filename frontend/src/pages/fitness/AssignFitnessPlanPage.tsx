import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Apple, Dumbbell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
  memberCode: string;
}

const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Meal = { mealType: string; name: string; description: string; calories: string; protein: string; carbs: string; fats: string };
type Exercise = { name: string; sets: string; reps: string; weight: string; restSeconds: string; notes: string };
type WorkoutDay = { dayOfWeek: number; name: string; exercises: Exercise[] };

const emptyMeal = (): Meal => ({ mealType: 'BREAKFAST', name: '', description: '', calories: '', protein: '', carbs: '', fats: '' });
const emptyExercise = (): Exercise => ({ name: '', sets: '3', reps: '10', weight: '', restSeconds: '60', notes: '' });

/** Trainer/owner tool to build a structured diet or workout plan for a
 *  specific member — meals and day-by-day exercises as separate entries,
 *  not a single free-text note. Assigning a new plan automatically
 *  deactivates any previous one (handled server-side). */
export function AssignFitnessPlanPage() {
  const [tab, setTab] = useState<'diet' | 'workout'>('diet');
  const [memberId, setMemberId] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: members } = useQuery<MemberOption[]>({
    queryKey: ['members', 'for-fitness-assign'],
    queryFn: async () => (await api.get('/members', { params: { limit: 200 } })).data?.data ?? [],
  });

  // ---- Diet state ----
  const [dietTitle, setDietTitle] = useState('');
  const [dietNotes, setDietNotes] = useState('');
  const [meals, setMeals] = useState<Meal[]>([emptyMeal()]);

  // ---- Workout state ----
  const [workoutTitle, setWorkoutTitle] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [days, setDays] = useState<WorkoutDay[]>([{ dayOfWeek: 1, name: 'Day 1', exercises: [emptyExercise()] }]);

  const resetMessages = () => { setSuccess(''); setError(''); };

  const submitDiet = async () => {
    resetMessages();
    if (!memberId || !dietTitle.trim() || meals.some((m) => !m.name.trim())) {
      setError('Select a member, give the plan a title, and name every meal.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/fitness/diet-plans', {
        memberId,
        title: dietTitle,
        notes: dietNotes || undefined,
        meals: meals.map((m, i) => ({
          mealType: m.mealType,
          name: m.name,
          description: m.description || undefined,
          calories: m.calories ? Number(m.calories) : undefined,
          protein: m.protein ? Number(m.protein) : undefined,
          carbs: m.carbs ? Number(m.carbs) : undefined,
          fats: m.fats ? Number(m.fats) : undefined,
          order: i,
        })),
      });
      setSuccess('Diet plan assigned successfully.');
      setDietTitle(''); setDietNotes(''); setMeals([emptyMeal()]);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the diet plan.');
    } finally {
      setSaving(false);
    }
  };

  const submitWorkout = async () => {
    resetMessages();
    if (!memberId || !workoutTitle.trim() || days.some((d) => !d.name.trim() || d.exercises.some((e) => !e.name.trim()))) {
      setError('Select a member, give the plan a title, and name every day and exercise.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/fitness/workout-plans', {
        memberId,
        title: workoutTitle,
        notes: workoutNotes || undefined,
        days: days.map((d, i) => ({
          dayOfWeek: d.dayOfWeek,
          name: d.name,
          order: i,
          exercises: d.exercises.map((e, j) => ({
            name: e.name,
            sets: Number(e.sets) || 1,
            reps: e.reps,
            weight: e.weight || undefined,
            restSeconds: e.restSeconds ? Number(e.restSeconds) : undefined,
            notes: e.notes || undefined,
            order: j,
          })),
        })),
      });
      setSuccess('Workout plan assigned successfully.');
      setWorkoutTitle(''); setWorkoutNotes(''); setDays([{ dayOfWeek: 1, name: 'Day 1', exercises: [emptyExercise()] }]);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the workout plan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Assign Fitness Plan</h1>
        <p className="text-sm text-muted-foreground">Build a structured diet or workout plan for a member.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Member</label>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Select a member…</option>
          {members?.map((m) => (
            <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.memberCode})</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab('diet')}
          className={`px-4 py-2 text-sm font-medium flex items-center gap-1 ${tab === 'diet' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
        >
          <Apple className="h-4 w-4" /> Diet Plan
        </button>
        <button
          onClick={() => setTab('workout')}
          className={`px-4 py-2 text-sm font-medium flex items-center gap-1 ${tab === 'workout' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
        >
          <Dumbbell className="h-4 w-4" /> Workout Plan
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      {tab === 'diet' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Diet Plan Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <input
              value={dietTitle}
              onChange={(e) => setDietTitle(e.target.value)}
              placeholder="Plan title, e.g. Cutting phase — Week 1-4"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <textarea
              value={dietNotes}
              onChange={(e) => setDietNotes(e.target.value)}
              placeholder="General notes (optional)"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="space-y-3">
              {meals.map((meal, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={meal.mealType}
                      onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, mealType: e.target.value } : m))}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      {MEAL_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                    </select>
                    <input
                      value={meal.name}
                      onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, name: e.target.value } : m))}
                      placeholder="Meal name, e.g. Oats with banana"
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setMeals(meals.filter((_, idx) => idx !== i))} disabled={meals.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input value={meal.calories} onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, calories: e.target.value } : m))} placeholder="kcal" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                    <input value={meal.protein} onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, protein: e.target.value } : m))} placeholder="Protein g" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                    <input value={meal.carbs} onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, carbs: e.target.value } : m))} placeholder="Carbs g" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                    <input value={meal.fats} onChange={(e) => setMeals(meals.map((m, idx) => idx === i ? { ...m, fats: e.target.value } : m))} placeholder="Fats g" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setMeals([...meals, emptyMeal()])}>
              <Plus className="h-4 w-4 mr-1" /> Add meal
            </Button>
            <div>
              <Button onClick={submitDiet} disabled={saving}>{saving ? 'Saving…' : 'Assign Diet Plan'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'workout' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Workout Plan Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <input
              value={workoutTitle}
              onChange={(e) => setWorkoutTitle(e.target.value)}
              placeholder="Plan title, e.g. Push/Pull/Legs — 6 day split"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <textarea
              value={workoutNotes}
              onChange={(e) => setWorkoutNotes(e.target.value)}
              placeholder="General notes (optional)"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="space-y-4">
              {days.map((day, di) => (
                <div key={di} className="rounded-lg border p-3 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={day.dayOfWeek}
                      onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, dayOfWeek: Number(e.target.value) } : d))}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      {DAY_NAMES.map((n, idx) => <option key={idx} value={idx}>{n}</option>)}
                    </select>
                    <input
                      value={day.name}
                      onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, name: e.target.value } : d))}
                      placeholder="Day name, e.g. Push Day"
                      className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setDays(days.filter((_, idx) => idx !== di))} disabled={days.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2">
                    {day.exercises.map((ex, ei) => (
                      <div key={ei} className="grid grid-cols-6 gap-2 items-center">
                        <input value={ex.name} onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: d.exercises.map((x, xi) => xi === ei ? { ...x, name: e.target.value } : x) } : d))} placeholder="Exercise" className="col-span-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                        <input value={ex.sets} onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: d.exercises.map((x, xi) => xi === ei ? { ...x, sets: e.target.value } : x) } : d))} placeholder="Sets" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                        <input value={ex.reps} onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: d.exercises.map((x, xi) => xi === ei ? { ...x, reps: e.target.value } : x) } : d))} placeholder="Reps" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                        <input value={ex.weight} onChange={(e) => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: d.exercises.map((x, xi) => xi === ei ? { ...x, weight: e.target.value } : x) } : d))} placeholder="Weight" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                        <Button variant="ghost" size="icon" onClick={() => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: d.exercises.filter((_, xi) => xi !== ei) } : d))} disabled={day.exercises.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => setDays(days.map((d, idx) => idx === di ? { ...d, exercises: [...d.exercises, emptyExercise()] } : d))}>
                      <Plus className="h-3 w-3 mr-1" /> Add exercise
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setDays([...days, { dayOfWeek: 1, name: `Day ${days.length + 1}`, exercises: [emptyExercise()] }])}>
              <Plus className="h-4 w-4 mr-1" /> Add day
            </Button>
            <div>
              <Button onClick={submitWorkout} disabled={saving}>{saving ? 'Saving…' : 'Assign Workout Plan'}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
