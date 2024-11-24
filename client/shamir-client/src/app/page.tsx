"use client"

import React, { useState, useEffect } from 'react';
import { Socket, io } from 'socket.io-client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type Step = 1 | 2 | 3 | 4 | 5;

interface Share {
  id: number;
  share: string;
}

interface ValidationError {
  field: string;
  message: string;
}

interface VoteResult {
  approved: number;
  rejected: number;
  totalVotes: number;
}

interface Member {
  id: string;
  name: string;
  hasVoted: boolean;
}

interface ClientState {
  currentStep: Step;
  resolution: string;
  totalMembers: number;
  threshold: number;
  members: Member[];
  votes: Record<string, boolean>;
  shares: Share[];
  currentMemberId: string | null;
}

const Client: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ClientState>({
    currentStep: 1,
    resolution: '',
    totalMembers: 0,
    threshold: 0,
    members: [],
    votes: {},
    shares: [],
    currentMemberId: null
  });

  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showJoinDialog, setShowJoinDialog] = useState<boolean>(false);
  const [memberName, setMemberName] = useState<string>('');
  const [submittedShares, setSubmittedShares] = useState<string[]>([]);
  const [isRevealing, setIsRevealing] = useState<boolean>(false);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [revealError, setRevealError] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sharesEntered, setSharesEntered] = useState<boolean>(false);

  const { toast } = useToast();

  // Socket.IO setup
  useEffect(() => {
    const newSocket = io('http://localhost:4000', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    // Connection event handlers
    newSocket.on('connect', () => {
      setConnectionStatus('connected');
      setConnectionError(null);
      toast({
        title: "Connected",
        description: "Connected to voting server"
      });
    });

    newSocket.on('disconnect', (reason: string) => {
      setConnectionStatus('disconnected');
      setConnectionError(`Disconnected: ${reason}`);
      toast({
        variant: "destructive",
        title: "Disconnected",
        description: "Lost connection to voting server"
      });
    });

    newSocket.on('connect_error', (error: Error) => {
      setConnectionError(`Connection error: ${error.message}`);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: error.message
      });
    });

    newSocket.on('reconnecting', (attemptNumber: number) => {
      setReconnecting(true);
      setConnectionStatus('connecting');
      toast({
        title: "Reconnecting",
        description: `Attempting to reconnect (${attemptNumber}/5)...`
      });
    });

    newSocket.on('reconnect', () => {
      setReconnecting(false);
      setConnectionStatus('connected');
      setConnectionError(null);
      
      // Request current state after reconnection
      newSocket.emit('requestState');
      toast({
        title: "Reconnected",
        description: "Reconnected to voting server"
      });
    });

    newSocket.on('reconnect_failed', () => {
      setReconnecting(false);
      setConnectionError('Failed to reconnect after multiple attempts');
      toast({
        variant: "destructive",
        title: "Reconnection Failed",
        description: "Please refresh the page to try again"
      });
    });

    // State update handler
    newSocket.on('stateUpdate', (newState: ClientState) => {
      setState(current => ({
        ...current,
        ...newState,
        currentMemberId: current.currentMemberId
      }));
    });

    newSocket.on('votingComplete', (results) => {
      setResult(results);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);


  // Effect to show join dialog
  useEffect(() => {
    if (state.currentStep === 3 && !state.currentMemberId) {
      setShowJoinDialog(true);
    }
  }, [state.currentStep, state.currentMemberId]);

  const handleSetup = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErrors([]);

    if (state.threshold > state.totalMembers) {
      setErrors([{
        field: 'threshold',
        message: 'Threshold cannot be greater than total members'
      }]);
      return;
    }

    if (state.totalMembers < 3) {
      setErrors([{
        field: 'totalMembers',
        message: 'Total members must be at least 3'
      }]);
      return;
    }

    socket?.emit('setupVoting', {
      totalMembers: state.totalMembers,
      threshold: state.threshold
    });
  };

  const handleCreateResolution = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!state.resolution.trim()) {
      setErrors([{
        field: 'resolution',
        message: 'Resolution text is required'
      }]);
      return;
    }

    socket?.emit('setResolution', { resolution: state.resolution });
  };

  const handleJoinSession = async (): Promise<void> => {
    if (!memberName.trim()) return;

    socket?.emit('joinVoting', { name: memberName });
    setState(current => ({
      ...current,
      currentMemberId: socket?.id || null
    }));
    setShowJoinDialog(false);
    toast({
      title: "Joined successfully",
      description: "You've joined the voting session"
    });
  };

  const handleSocketEvent = async (
    eventName: string, 
    payload: any, 
    errorMessage: string
  ): Promise<boolean> => {
    if (!socket?.connected) {
      toast({
        variant: "destructive",
        title: "Not Connected",
        description: "Cannot perform action while disconnected"
      });
      return false;
    }

    try {
      return new Promise((resolve) => {
        socket.emit(eventName, payload, (response: { success: boolean, error?: string }) => {
          if (response.success) {
            resolve(true);
          } else {
            toast({
              variant: "destructive",
              title: "Error",
              description: response.error || errorMessage
            });
            resolve(false);
          }
        });
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage
      });
      return false;
    }
  };

  const handleVote = async (vote: boolean): Promise<void> => {
    if (!state.currentMemberId) return;

    const success = await handleSocketEvent('submitVote', { vote }, 'Failed to submit vote');
    if (success) {
      toast({
        title: "Vote submitted",
        description: "Your vote has been recorded"
      });
    }
  };

  const handleShareInput = (index: number, value: string): void => {
    const newShares = [...submittedShares];
    newShares[index] = value;
    setSubmittedShares(newShares);
    setRevealError('');
  };

  const handleRevealResult = async (): Promise<void> => {
    const validShares = submittedShares.filter(share => share && share.trim());
    
    if (validShares.length < state.threshold) {
      setRevealError(`Need at least ${state.threshold} shares to reveal the result. Currently have ${validShares.length}.`);
      return;
    }

    setIsRevealing(true);
    setSharesEntered(true);
    
    try {
      socket?.emit('revealResult', { shares: validShares }, (response: { success: boolean, error?: string, result?: VoteResult }) => {
        if (response.success && response.result) {
          setResult(response.result);
          toast({
            title: "Result Revealed",
            description: "The voting result has been successfully revealed"
          });
        } else {
          setRevealError(response.error || 'Failed to reveal result');
          setSharesEntered(false); // Reset if failed
          toast({
            variant: "destructive",
            title: "Error",
            description: response.error || 'Failed to reveal result'
          });
        }
      });
    } catch (error) {
      setRevealError('Failed to reconstruct the result. Please verify your shares and try again.');
      setSharesEntered(false); // Reset if failed
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to reveal result"
      });
    } finally {
      setIsRevealing(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    socket?.emit('reset');
    setState({
      currentStep: 1,
      resolution: '',
      totalMembers: 0,
      threshold: 0,
      members: [],
      votes: {},
      shares: [],
      currentMemberId: null
    });
    setShowJoinDialog(false);
    setMemberName('');
    setSubmittedShares([]);
    setIsRevealing(false);
    setResult(null);
    setRevealError('');
    setErrors([]);
    setSharesEntered(false);   
    
    toast({
      title: "Session reset",
      description: "The voting session has been reset"
    });
  };

  const validateThreshold = (value: string): void => {
    const numValue = parseInt(value, 10);
    if (numValue <= 1) {
      setErrors([{
        field: 'threshold',
        message: 'Threshold must be at least 2'
      }]);
    } else {
      setErrors([]);
      setState(current => ({
        ...current,
        threshold: numValue
      }));
    }
  };

  const getErrorMessage = (field: string): string | undefined => {
    return errors.find(error => error.field === field)?.message;
  };

  const ConnectionStatusBanner = () => {
    if (connectionStatus === 'connected' && !connectionError) return null;
    return (
      <Alert 
        variant={connectionStatus === 'connecting' ? 'default' : 'destructive'}
        className="mb-4"
      >
        <AlertTitle>
          {connectionStatus === 'connecting' ? 'Connecting...' : 'Connection Error'}
        </AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>
            {connectionError || 'Establishing connection to voting server...'}
          </span>
          {reconnecting && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  const renderSetup = () => (
    <TabsContent value="step1">
      <form onSubmit={handleSetup} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="totalMembers">Number of Board Members</Label>
          <Input
            id="totalMembers"
            type="number"
            min="3"
            required
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
              setState(current => ({
                ...current,
                totalMembers: parseInt(e.target.value, 10)
              }))}
            className={getErrorMessage('totalMembers') ? 'border-red-500' : ''}
          />
          {getErrorMessage('totalMembers') && (
            <p className="text-sm text-red-500">{getErrorMessage('totalMembers')}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="threshold">
            Threshold (minimum shares needed to reveal result)
          </Label>
          <Input
            id="threshold"
            type="number"
            min="2"
            required
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
              validateThreshold(e.target.value)}
            className={getErrorMessage('threshold') ? 'border-red-500' : ''}
          />
          {getErrorMessage('threshold') && (
            <p className="text-sm text-red-500">{getErrorMessage('threshold')}</p>
          )}
          <CardDescription className="text-sm">
            Must be less than or equal to total members
          </CardDescription>
        </div>
        <Button type="submit">Continue</Button>
      </form>
    </TabsContent>
  );

  const renderResolution = () => (
    <TabsContent value="step2">
      <form onSubmit={handleCreateResolution} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="resolution">Resolution Text</Label>
          <Input
            id="resolution"
            required
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
              setState(current => ({
                ...current,
                resolution: e.target.value
              }))}
            placeholder="Enter the resolution to be voted on..."
            className={getErrorMessage('resolution') ? 'border-red-500' : ''}
          />
          {getErrorMessage('resolution') && (
            <p className="text-sm text-red-500">{getErrorMessage('resolution')}</p>
          )}
        </div>
        <Button type="submit">Create Resolution</Button>
      </form>
    </TabsContent>
  );

  const renderVotingRoom = () => {
    const hasUserJoined = state.members.some(m => m.id === state.currentMemberId);
    const hasUserVoted = state.currentMemberId ? Boolean(state.votes[state.currentMemberId]) : false;
    const canProceedToShares = 
    state.members.length === state.totalMembers && 
    Object.keys(state.votes).length === state.totalMembers;

    return (
    <TabsContent value="step3">
      <div className="space-y-6">
        <Alert>
          <AlertDescription>
            Resolution: {state.resolution}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Members Joined: {state.members.length}/{state.totalMembers}</span>
              <span>Votes Cast: {Object.keys(state.votes).length}/{state.totalMembers}</span>
            </div>
            <Progress 
              value={(state.members.length / state.totalMembers) * 100} 
              className="h-2"
            />
          </div>

          <ScrollArea className="h-[400px] rounded-md border p-4">
            <div className="space-y-4">
              {state.members.map((member) => (
                <Card key={member.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {member.name}
                          {member.id === state.currentMemberId && " (You)"}
                        </span>
                        {state.votes[member.id] !== undefined && (
                          <Badge variant="default">
                            Voted
                          </Badge>
                        )}
                      </div>
                      
                      {member.id === state.currentMemberId && !state.votes[member.id] && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleVote(true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleVote(false)}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {Array.from({ length: state.totalMembers - state.members.length }, (_, index) => (
                <Card key={`empty-${index}`}>
                  <CardContent className="p-4">
                    <div className="text-muted-foreground">
                      Waiting for member to join...
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Status messages */}
          {!hasUserJoined ? (
            <Alert>
              <AlertDescription>
                Please enter your name to join the voting session
              </AlertDescription>
            </Alert>
          ) : !hasUserVoted ? (
            <Alert>
              <AlertDescription>
                Please cast your vote on the resolution
              </AlertDescription>
            </Alert>
          ) : !canProceedToShares ? (
            <Alert>
              <AlertDescription>
                Waiting for all members to join and vote...
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </TabsContent>
    );
  };

  const renderShareDistribution = () => (
    <TabsContent value="step4">
      <div className="space-y-6">
        <Alert>
          <AlertDescription>
            Voting complete! Each member receives their share:
          </AlertDescription>
        </Alert>
        <ScrollArea className="h-[400px] rounded-md border p-4">
          {state.shares.map((share) => (
            <div key={share.id} className="mb-4 p-4 border rounded">
              <Label>Board Member {share.id}</Label>
              <div className="mt-2 p-2 bg-muted rounded">
                <code className="text-sm">{share.share}</code>
              </div>
            </div>
          ))}
        </ScrollArea>
        <Button onClick={() => setState(current => ({ ...current, currentStep: 5 }))}>
          Proceed to Result Recovery
        </Button>
      </div>
    </TabsContent>
  );

  const renderResultRecovery = () => (
    <TabsContent value="step5">
      <div className="space-y-6">
        <Alert>
          <AlertDescription>
            Enter {state.threshold} or more shares to reveal the result
          </AlertDescription>
        </Alert>
        
        {result === null && sharesEntered === false ? (
          <>
            <ScrollArea className="h-[400px] rounded-md border p-4">
              {Array.from({ length: state.threshold }, (_, i) => (
                <div key={i} className="mb-4">
                  <Label>Share {i + 1}</Label>
                  <Input 
                    className="mt-2" 
                    placeholder="Enter share value..." 
                    onChange={(e) => handleShareInput(i, e.target.value)}
                    value={submittedShares[i] || ''}
                  />
                </div>
              ))}
            </ScrollArea>

            {revealError && (
              <Alert variant="destructive">
                <AlertDescription>{revealError}</AlertDescription>
              </Alert>
            )}

            <Progress 
              value={(submittedShares.filter(s => s && s.trim()).length / state.threshold) * 100} 
              className="w-full"
            />
            
            <Button 
              onClick={handleRevealResult}
              disabled={isRevealing}
            >
              {isRevealing ? 'Reconstructing Result...' : 'Reveal Result'}
            </Button>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Resolution Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-lg font-medium">
                Resolution: {state.resolution}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span>Approved:</span>
                  <span className="font-bold text-green-500">
                    {result?.approved!} votes ({((result?.approved! / result?.totalVotes!) * 100).toFixed(1)}%)
                  </span>
                </div>
                <Progress value={(result?.approved! / result?.totalVotes!) * 100} className="bg-red-200">
                  <div className="bg-green-500 h-full transition-all" />
                </Progress>
                <div className="flex justify-between items-center">
                  <span>Rejected:</span>
                  <span className="font-bold text-red-500">
                    {result?.rejected!} votes ({((result?.rejected! / result?.totalVotes!) * 100).toFixed(1)}%)
                  </span>
                </div>
              </div>
              <Alert className={result?.approved! > result?.rejected! ? 'bg-green-100' : 'bg-red-100'}>
                <AlertTitle>Final Outcome</AlertTitle>
                <AlertDescription>
                  The resolution has been {result?.approved! > result?.rejected! ? 'APPROVED' : 'REJECTED'} by the board.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}
      </div>
    </TabsContent>
  );


  return (
    <div className="min-h-screen bg-background p-8">
      <ConnectionStatusBanner />
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl font-bold">
                Secure Board Resolution System
              </CardTitle>
              <CardDescription>
                Using Shamir's Secret Sharing Scheme
              </CardDescription>
            </div>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={handleReset}
            >
              Reset Session
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={`step${state.currentStep}`} className="w-full">
            <TabsList className="hidden">
              <TabsTrigger value="step1">Setup</TabsTrigger>
              <TabsTrigger value="step2">Resolution</TabsTrigger>
              <TabsTrigger value="step3">Voting</TabsTrigger>
              <TabsTrigger value="step4">Shares</TabsTrigger>
              <TabsTrigger value="step5">Recovery</TabsTrigger>
            </TabsList>

            {renderSetup()}
            {renderResolution()}
            {renderVotingRoom()}
            {renderShareDistribution()}
            {renderResultRecovery()}
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join Voting Session</DialogTitle>
            <DialogDescription>
              Enter your name to join the voting session
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Enter your name"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinSession()}
            />
            <Button onClick={handleJoinSession}>Join Session</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Client;
