export declare function validateSealedBaseline(input:{
 scoreBytes:Buffer|Uint8Array;resultsBytes:Buffer|Uint8Array;receiptBytes:Buffer|Uint8Array;scorerBytes:Buffer|Uint8Array;
 publicKeyPem:string|Buffer;pinnedFingerprint:string|undefined;sourceCommit:string;benchmarkDigest:string;run:number;
}):Readonly<{verified:true;run:number;session_id:string;source_commit:string;benchmark_sha256:string}>;
