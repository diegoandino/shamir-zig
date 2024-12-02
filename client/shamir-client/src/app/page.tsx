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
  x: number, 
  y: string,
  toString(): string
}

interface ValidationError {
  field: string;
  message: string;
}
50
interface VoteResult {
  approved: boolean;
  reconstructedSecret: string;
}

interface Member {
  id: string;
  name: string;
  hasVoted: boolean;
  share: Share
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
  shareIndex: number;
  submittedShares: Share[];
  reconstructionLeader: string | null;
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
    currentMemberId: null,
    shareIndex: 0,
    submittedShares: [],
    reconstructionLeader: null
  });

  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showJoinDialog, setShowJoinDialog] = useState<boolean>(false);
  const [memberName, setMemberName] = useState<string>('');
  const [isRevealing, setIsRevealing] = useState<boolean>(false);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [revealError, setRevealError] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sharesEntered, setSharesEntered] = useState<boolean>(false);
  const [phraseInputs, setPhraseInputs] = useState<string[]>([]);

  const { toast } = useToast();
  const MAX_MEMBERS:number = 50;

  // Socket.IO setup
  useEffect(() => {
    const newSocket = io('https://api-andino.ngrok.dev', {
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
      setState(current => {
        // Preserve client-specific data
        const clientData = {
          currentMemberId: current.currentMemberId
        };

        // Create new state with server data taking precedence
        const updatedState = {
          ...newState,
          ...clientData, // Override with client-specific data
          members: [...newState.members], // Create new array reference
          votes: { ...newState.votes }, // Create new object reference
          submittedShares: [...(newState.submittedShares || [])], // Handle possible undefined
          reconstructionLeader: newState.reconstructionLeader
        };

        return updatedState;
      });
    });

    newSocket.on('votingComplete', (results) => {
      if (results.result) {
        const secret = binaryToString(results.result);
        setResult({
          approved: results.approved,
          reconstructedSecret: secret
        });
      }    
    });

    newSocket.on('shareReceived', (shareData) => {
      setState(current => ({
        ...current,
        myShare: shareData.share
      }));
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (state.totalMembers)
      setPhraseInputs(new Array(state.totalMembers).fill(''));
  }, [state.totalMembers]);

  // Effect to show join dialog
  useEffect(() => {
    if (state.currentStep === 3 && !state.currentMemberId) {
      setShowJoinDialog(true);
    }
  }, [state.currentStep, state.currentMemberId]);

  useEffect(() => {
    if (state.currentStep === 4) {
      handleRevealResult();
    }
  }, [state.currentStep]);


  function stringToBinary(input: string): string {
    let result = 0n;
    
    // Store each character as a full 32-bit value to preserve exact Unicode values
    for (let i = 0; i < input.length; i++) {
        // Get the exact character code
        const charCode = BigInt(input.charCodeAt(i));
        
        // Shift existing bits left by 32 and add new character
        // Using 32 bits per character ensures we capture the full Unicode range
        result = (result << 32n) | charCode;
    }
    
    // Store the length at the end (32 bits)
    result = (result << 32n) | BigInt(input.length);
    
    return result.toString();
  }

  function binaryToString(binaryStr: string): string {
    // Parse the string parameter into a BigInt
    const binary = BigInt(binaryStr);
    
    // Extract the length (last 32 bits)
    const length = Number(binary & ((1n << 32n) - 1n));
    let binaryValue = binary >> 32n;
    
    // Extract each character
    const chars: string[] = new Array(length);
    for (let i = length - 1; i >= 0; i--) {
        const charCode = Number(binaryValue & ((1n << 32n) - 1n));
        chars[i] = String.fromCharCode(charCode);
        binaryValue = binaryValue >> 32n;
    }
    
    return chars.join('');
  }

  const handleSetup = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErrors([]);
    
    if (state.totalMembers > MAX_MEMBERS) {
      setErrors([{
        field: 'totalMembers',
        message: `Total members cannot exceed ${MAX_MEMBERS}`
      }]);
      return;
    }

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

    socket?.emit('setResolution', { resolution: stringToBinary(state.resolution) });
  };

  const handleJoinSession = async (): Promise<void> => {
    if (!memberName.trim()) return;
    try {
      const response = await new Promise<{ 
        success: boolean; 
        memberId?: string; 
        member?: { 
          id: string;
          name: string;
          hasVoted: boolean;
          share: {
            x: number;
            y: string;
          }
        } 
      }>((resolve) => {
        socket?.emit('joinVoting', { name: memberName }, resolve);
      });

      if (response.success && response.memberId && response.member) {
        const currentMember = response.member;
        const newMember: Member = {
          id: response.memberId,
          hasVoted: response.member.hasVoted,
          name: response.member.name,
          share: {
            x: response.member.share.x,
            y: response.member.share.y
          }
        };

        setState(current => {
          const memberExists = current.members.some(member => member.id === response.memberId);
          
          return {
            ...current,
            currentMemberId: response.memberId || null,
            members: memberExists
              ? current.members.map(member =>
                  member.id === response.memberId
                    ? { ...member, share: currentMember.share }
                    : member
                )
              : [...current.members, newMember]
          };
        });

        setShowJoinDialog(false);
        toast({
          title: "Joined successfully",
          description: "You've joined the voting session"
        });
      } else {
        toast({
          variant: "default",
          title: "Failed to join",
          description: "Unknown error occurred"
        });
      }
    } catch (error) {
      console.error('Join session error:', error);
      toast({
        variant: "default",
        title: "Error",
        description: "Failed to join session"
      });
    }
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

    const currentMember = state.members.find(m => m.id === state.currentMemberId);
    if (!currentMember) return;

    const success = await handleSocketEvent('submitVote', { 
      vote,
      share: vote ? currentMember.share : null,
      memberId: state.currentMemberId
    }, 'Failed to submit vote');

    if (success) {
      toast({
        title: "Vote submitted",
        description: "Your vote has been recorded"
      });    
    }
  };

  const handleRevealResult = async (): Promise<void> => {
    if (state.reconstructionLeader !== state.currentMemberId)
      return;
    
    if (isRevealing) 
      return;

    setIsRevealing(true);

    try {
      const submittedShares = state.members.filter(m => m.hasVoted);
      
      // Add validation
      if (submittedShares.length < state.threshold) {
        toast({
          variant: "destructive",
          title: "Error",
          description: `Need at least ${state.threshold} shares. Have ${submittedShares.length}.`
        });
        return;
      }

      const formattedShares = submittedShares.map(s => {
        try {
          const share:Share = {
            x: s.share.x,
            y: s.share.y,
            toString():string {
              return `{ x: ${this.x}, y: ${this.y} }` 
            }
          }

          const cleanShare = share
            .toString()
            .trim()          
            .replace(/\s+/g, ' ')          
            .replace(/:\s*/g, ': ')
            .toLowerCase();

          console.log("clean share: ", cleanShare)
          // Use regex to extract x and y values
          const xMatch = cleanShare.match(/x:\s*(-?\d+)/);
          const yMatch = cleanShare.match(/y:\s*(-?\d+)/);

          console.log("x: ", xMatch)
          console.log("y: ", yMatch)
          if (!xMatch || !yMatch) {
            throw new Error(`Invalid share format: ${share}`);
          }

          return {
            x: xMatch[1],
            y: yMatch[1]
          };
        } catch (error) {
          //setRevealError(`Invalid share format: ${share}`);
          throw error;
        }
      });
      
      try {
        socket?.emit('revealResult', { shares: formattedShares }, (response: { success: boolean, error?: string, result?: string }) => {
          if (response.success && response.result) {
            const secret:string = binaryToString(response.result)
            console.log("sec: ", secret)
            const result:VoteResult = { approved: true, reconstructedSecret: secret }
            console.log("result: ", result)
            setResult(result);
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
    } 
    catch (error) {
    } 
    finally {
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
      currentMemberId: null,
      shareIndex: 0,
      submittedShares: [],
      reconstructionLeader: null
    });
    setShowJoinDialog(false);
    setMemberName('');
    setIsRevealing(false);
    setResult(null);
    setRevealError('');
    setErrors([]);
    setSharesEntered(false);   
    setPhraseInputs([]);

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

  const formatLongString = (str: string): string => {
    if (str.length <= 10) return str;
    return `${str.substring(0, 4)}...${str.substring(str.length - 3)}`;
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
            max="50"
            required
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const val = parseInt(e.target.value, 10)
              if (isNaN(val) || val <= MAX_MEMBERS) {
                setState(current => ({
                  ...current,
                  totalMembers: val                
                }))}
              }
            }
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

  const renderResolution = () => {
    const handlePhraseInput = (index: number, value: string) => {
      // Remove any spaces from the input value
      const cleanValue = value.replace(/\s/g, '');
      
      const newPhrases = [...phraseInputs];
      newPhrases[index] = cleanValue;
      setPhraseInputs(newPhrases);

      const validPhrases = newPhrases.filter(phrase => phrase !== '');
      if (validPhrases.length >= state.threshold) {
        const combinedPhrase = validPhrases.join('-');
        
        setState(current => ({
          ...current,
          resolution: combinedPhrase
        }));
      }
    };

    return (
     <TabsContent value="step2">
       <form onSubmit={handleCreateResolution} className="space-y-6">
         <div className="space-y-4">
           <div className="flex items-center justify-between">
             <Label htmlFor="phrases">Enter Secret Phrases</Label>
           </div>
           
           <div className="grid grid-cols-3 gap-4">
             {Array.from({ length: state.totalMembers }, (_, i) => (
               <div 
                 key={i} 
                 className={`relative group ${
                   i < state.threshold ? 'required' : ''
                 }`}
               >
                 <div className="absolute -top-3 left-2 bg-background px-1">
                   <span className="text-xs text-muted-foreground">
                     {i + 1}
                   </span>
                 </div>
                 <Input
                   value={phraseInputs[i] || ''}
                   onChange={(e) => handlePhraseInput(i, e.target.value)}
                   className={`border-2 border-primary bg-muted/50 focus:bg-background`}
                   placeholder="Enter phrase"
                 />
                 <span className="absolute -top-3 right-2 text-xs text-red-500">
                   *
                 </span>
               </div>
             ))}
           </div>

           <div className="flex items-center justify-between">
             <Button 
               type="submit"
               disabled={phraseInputs.filter(p => p.trim() !== '').length < state.totalMembers}
             >
               Submit Secret
             </Button>
           </div>

           {getErrorMessage('resolution') && (
             <Alert variant="destructive">
               <AlertDescription>
                 {getErrorMessage('resolution')}
               </AlertDescription>
             </Alert>
           )}
         </div>
       </form>
     </TabsContent>
    );
  };

  const renderVotingRoom = () => {
    const hasUserJoined = state.members.some(m => m.id === state.currentMemberId);
    const hasUserVoted = state.currentMemberId ? Boolean(state.votes[state.currentMemberId]) : false;
    const currentMember = state.members.find(m => m.id === state.currentMemberId);

    return (
      <TabsContent value="step3">
        <div className="space-y-6">
          <Alert>
            <AlertDescription>
              Voting to recover secret key
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
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {member.name}
                              {member.id === state.currentMemberId && " (Me)"}
                            </span>
                            {state.votes[member.id] !== undefined && (
                              <Badge variant={state.votes[member.id] ? "default" : "destructive"}>
                                {state.votes[member.id] ? "Approved" : "Rejected"}
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
                        
                        {/* Show share information */}
                        {member.share && member.id === state.currentMemberId && (
                          <div className="mt-2 p-2 bg-muted rounded text-sm font-mono">
                            Share: (x: {member.share.x}, y: {formatLongString(member.share.y)})
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
                  Please cast your vote. Your share will be used for reconstruction if you approve.
                </AlertDescription>
              </Alert>
            ) : state.votes[state.currentMemberId!] ? (
              <Alert>
                <AlertDescription>
                  Your share will be used in the final reconstruction.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertDescription>
                  You rejected the proposal. Your share will not be used in reconstruction.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </TabsContent>
    );
  };

  const renderResultRecovery = () => (
    <TabsContent value="step4">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Resolution Result</CardTitle>
          </CardHeader>
          {!result ? (
            <CardContent>
              <Alert>
                <AlertDescription>
                  Waiting for result...
                </AlertDescription>
              </Alert>
            </CardContent>
          ) : (
            <CardContent className="space-y-4">
              {result.approved ? (
                <Alert className="bg-green-100">
                  <AlertTitle>Vote Passed!</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-2">
                      <p>The secret has been reconstructed:</p>
                      <div className="p-4 bg-muted rounded-md font-mono">
                        {result.reconstructedSecret}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="bg-red-100" variant="destructive">
                  <AlertTitle>Vote Failed</AlertTitle>
                  <AlertDescription>
                    <p>The vote was rejected by the board members.</p>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          )}
        </Card>
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
              <TabsTrigger value="step4">Recovery</TabsTrigger>
            </TabsList>
            {renderSetup()}
            {renderResolution()}
            {renderVotingRoom()}
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
