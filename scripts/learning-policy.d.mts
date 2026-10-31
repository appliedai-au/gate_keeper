export interface LearningFile {path:string; text:string}
export declare function hash(data: string|Uint8Array):string;
export declare function canonical(value: unknown):string;
export declare function validateCandidate(files: LearningFile[], baselineInstructions:string):LearningFile[];
export declare function candidateDigest(files: LearningFile[], baselineInstructions:string):string;
export interface Qualification {qualified:true;candidate_digest:string;source_commit:string}
export declare function verifyQualification(input:{report:Record<string,unknown>;signature:string;publicKeyPem:string;expected:Record<string,string>}):Qualification;
