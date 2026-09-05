import { useQuery } from '@tanstack/react-query';
import { Apple, Dumbbell, Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@services/api';

interface Meal {
  id: string;
  mealType: string;
  name: string;
  description?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
}

interface DietPlan {
  id: string;
  title: string;
  notes?: string | null;
  meals: Meal[];
}

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  weight?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
}

interface WorkoutDay {
  id: string;
  dayOfWeek: number;
  name: string;
  exercises: Exercise[];
}

interface WorkoutPlan {
  id: string;
  title: string;
  notes?: string | null;
  days: WorkoutDay[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner', SNACK: 'Snack',
  PRE_WORKOUT: 'Pre-Workout', POST_WORKOUT: 'Post-Workout',
};

/** Member's own view of the diet + workout plan their trainer/gym owner
 *  assigned them — read-only, structured (meals broken out, workouts
 *  broken into day-by-day exercises) rather than a single free-text note. */
export function MyFitnessPage() {
  const { data: diet, isLoading: dietLoading } = useQuery<DietPlan | null>({
    queryKey: ['fitness', 'diet', 'mine'],
    queryFn: async () => (await api.get('/fitness/diet-plans/mine')).data,
  });
  const { data: workout, isLoading: workoutLoading } = useQuery<WorkoutPlan | null>({
    queryKey: ['fitness', 'workout', 'mine'],
    queryFn: async () => (await api.get('/fitness/workout-plans/mine')).data,
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">My Fitness Plan</h1>
        <p className="text-sm text-muted-foreground">Diet and workout plans set by your trainer or gym.</p>
      </div>

      {/* ---------- Diet ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Apple className="h-5 w-5 text-green-600" /> Diet Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dietLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!dietLoading && !diet && (
            <p className="text-sm text-muted-foreground">No diet plan assigned yet — ask your trainer.</p>
          )}
          {diet && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">{diet.title}</h3>
                {diet.notes && <p className="text-sm text-muted-foreground">{diet.notes}</p>}
              </div>
              <div className="space-y-3">
                {diet.meals.map((meal) => (
                  <div key={meal.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{meal.name}</span>
                      <Badge variant="outline">{MEAL_LABELS[meal.mealType] ?? meal.mealType}</Badge>
                    </div>
                    {meal.description && <p className="text-sm text-muted-foreground mt-1">{meal.description}</p>}
                    {(meal.calories || meal.protein || meal.carbs || meal.fats) && (
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        {meal.calories != null && <span>{meal.calories} kcal</span>}
                        {meal.protein != null && <span>P: {meal.protein}g</span>}
                        {meal.carbs != null && <span>C: {meal.carbs}g</span>}
                        {meal.fats != null && <span>F: {meal.fats}g</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Workout ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-blue-600" /> Workout Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workoutLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!workoutLoading && !workout && (
            <p className="text-sm text-muted-foreground">No workout plan assigned yet — ask your trainer.</p>
          )}
          {workout && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold">{workout.title}</h3>
                {workout.notes && <p className="text-sm text-muted-foreground">{workout.notes}</p>}
              </div>
              <div className="space-y-4">
                {workout.days.map((day) => (
                  <div key={day.id} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Flame className="h-4 w-4 text-orange-500" />
                      <span className="font-medium">{DAY_NAMES[day.dayOfWeek]} — {day.name}</span>
                    </div>
                    <div className="space-y-2">
                      {day.exercises.map((ex) => (
                        <div key={ex.id} className="flex items-center justify-between text-sm border-t pt-2 first:border-t-0 first:pt-0">
                          <div>
                            <span className="font-medium">{ex.name}</span>
                            {ex.notes && <p className="text-xs text-muted-foreground">{ex.notes}</p>}
                          </div>
                          <div className="text-right text-muted-foreground">
                            <div>{ex.sets} × {ex.reps}{ex.weight ? ` @ ${ex.weight}` : ''}</div>
                            {ex.restSeconds != null && <div className="text-xs">Rest: {ex.restSeconds}s</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
