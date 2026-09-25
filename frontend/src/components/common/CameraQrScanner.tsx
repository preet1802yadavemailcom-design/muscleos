import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera, CameraOff, RefreshCw, AlertCircle, Zap, ZapOff, FlipHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import jsQR from 'jsqr';

interface CameraQrScannerProps {
  onScan: (data: string) => void;
  className?: string;
  autoStart?: boolean;
}

export function CameraQrScanner({
  onScan,
  className = '',
  autoStart = false,
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const cooldownRef = useRef(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Check if device has multiple video inputs
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setHasMultipleCameras(videoInputs.length > 1);
    }).catch(() => {});
  }, []);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsLoading(false);
    setTorchOn(false);
    setHasTorch(false);
  }, []);

  const startCamera = useCallback(async (desiredFacing: 'environment' | 'user' = facingMode) => {
    stopCamera();
    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      let stream: MediaStream;
      try {
        // Preferred constraint: environment camera with reasonable resolution
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: desiredFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err: any) {
        // Fallback constraint if ideal facing mode fails (e.g., PC webcam without environment mode)
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      // Check torch capability on the active video track
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          setHasTorch(true);
        }
      }

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element not mounted.');
      }

      // Explicitly set attributes to avoid iOS/Android autoplay and black-screen issues
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.srcObject = stream;

      // Ensure video metadata is loaded before starting playback
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
        } else {
          video.onloadeddata = () => resolve();
        }
      });

      await video.play();
      setIsCameraActive(true);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Camera initialization error:', err);
      stopCamera();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera permission was denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMsg('No camera device found on this system.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMsg('Camera is already in use by another application.');
      } else {
        setErrorMsg(err.message || 'Unable to start camera.');
      }
    }
  }, [facingMode, stopCamera]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && hasTorch) {
      try {
        const next = !torchOn;
        await (track as any).applyConstraints({ advanced: [{ torch: next }] });
        setTorchOn(next);
      } catch (err) {
        console.error('Failed to toggle torch:', err);
      }
    }
  };

  // Flip Camera (Front / Rear)
  const flipCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Detection loop (supports BarcodeDetector natively + jsQR universal canvas fallback)
  useEffect(() => {
    if (!isCameraActive) return;

    let isSubscribed = true;
    const BarcodeDetectorClass: any = (window as any).BarcodeDetector;
    let detector: any = null;

    if (BarcodeDetectorClass) {
      try {
        detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
      } catch {
        detector = null;
      }
    }

    const scanFrame = async () => {
      if (!isSubscribed) return;

      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0 && !cooldownRef.current) {
        let detected = false;

        // Method A: Native BarcodeDetector (fastest on Chromium/Android)
        if (detector) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              detected = true;
              triggerScan(barcodes[0].rawValue);
            }
          } catch {
            // Native detector frame error — fall back to jsQR
          }
        }

        // Method B: jsQR Canvas fallback (works on iOS Safari, Firefox, Desktop, all webviews)
        if (!detected) {
          try {
            let canvas = canvasRef.current;
            if (!canvas) {
              canvas = document.createElement('canvas');
              canvasRef.current = canvas;
            }

            const width = video.videoWidth;
            const height = video.videoHeight;
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, width, height);
              const imageData = ctx.getImageData(0, 0, width, height);
              const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });

              if (qr && qr.data) {
                triggerScan(qr.data);
              }
            }
          } catch {
            // Ignore frame capture issues
          }
        }
      }

      if (isSubscribed) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    const triggerScan = (scannedValue: string) => {
      if (cooldownRef.current) return;
      cooldownRef.current = true;

      // Haptic feedback if supported
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([40, 30, 40]);
        }
      } catch {}

      onScan(scannedValue);

      // Cooldown timer to prevent re-reading identical code repeatedly in the same instant
      setTimeout(() => {
        cooldownRef.current = false;
      }, 2500);
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      isSubscribed = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isCameraActive, onScan]);

  // Clean up on component unmount
  useEffect(() => {
    if (autoStart) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [autoStart, startCamera, stopCamera]);

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-black ${className}`}>
      {/* Video element is permanently rendered in DOM to guarantee ref is always ready */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isCameraActive && !isLoading ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Target Scanning Reticle Overlay */}
      {isCameraActive && !isLoading && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Darkened background with central clear target square */}
          <div className="relative w-64 h-64 sm:w-72 sm:h-72">
            {/* 4 Corner Markers */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-lg" />

            {/* Scanning Laser Line */}
            <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#10b981] animate-bounce" />
          </div>

          <div className="absolute bottom-4 left-0 right-0 text-center">
            <span className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium shadow">
              Align QR code within frame
            </span>
          </div>
        </div>
      )}

      {/* Loading State Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4 space-y-3 z-10">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Starting camera feed...</p>
        </div>
      )}

      {/* Inactive State Placeholder */}
      {!isCameraActive && !isLoading && !errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/40 p-6 text-center space-y-3">
          <div className="p-4 rounded-2xl bg-primary/10 text-primary">
            <Camera className="h-10 w-10" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">Camera is inactive</p>
            <p className="text-xs text-muted-foreground mt-0.5">Click below to open the camera scanner</p>
          </div>
          <Button onClick={() => startCamera()} size="sm" className="gap-2 font-medium">
            <Camera className="h-4 w-4" /> Start Camera
          </Button>
        </div>
      )}

      {/* Error State Overlay */}
      {errorMsg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 p-6 text-center space-y-3 z-10">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div className="max-w-xs">
            <p className="font-semibold text-sm text-destructive">Camera Error</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => startCamera()} className="gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Try Again
          </Button>
        </div>
      )}

      {/* Controls Overlay when camera is Active */}
      {isCameraActive && (
        <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
          {hasMultipleCameras && (
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm"
              onClick={flipCamera}
              title="Flip Camera"
            >
              <FlipHorizontal className="h-4 w-4" />
            </Button>
          )}

          {hasTorch && (
            <Button
              size="icon"
              variant="secondary"
              className={`h-8 w-8 rounded-full backdrop-blur-sm ${
                torchOn ? 'bg-amber-500 text-black hover:bg-amber-400' : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              onClick={toggleTorch}
              title={torchOn ? 'Turn off flash' : 'Turn on flash'}
            >
              {torchOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
            </Button>
          )}

          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-rose-600 hover:text-white backdrop-blur-sm transition-colors"
            onClick={stopCamera}
            title="Stop Camera"
          >
            <CameraOff className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
