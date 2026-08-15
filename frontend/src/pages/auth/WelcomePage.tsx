import { useNavigate } from 'react-router-dom';
import { Dumbbell, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-primary rounded-2xl flex items-center justify-center mb-4">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">MuscleOS</h2>
          <p className="mt-2 text-muted-foreground">Enterprise Gym Management</p>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            className="w-full h-12 text-base"
            onClick={() => navigate('/register')}
          >
            <UserPlus className="h-5 w-5 mr-2" />
            Create your gym account
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 text-base"
            onClick={() => navigate('/login')}
          >
            <LogIn className="h-5 w-5 mr-2" />
            Sign in to existing account
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          New here? Create your gym account and start a free trial.
          <br />
          Already have an account? Sign in to continue.
        </p>
      </div>
    </div>
  );
}