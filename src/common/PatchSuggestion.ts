export interface PatchSuggestion {
    path?: string;
    kind: 'append_block' | 'insert_block' | 'replace_block';
    summary: string;
    before?: string;
    after: string;
}

export function buildPatchSuggestion(args: {
    path?: string;
    kind: PatchSuggestion['kind'];
    summary: string;
    before?: string;
    after: string;
}): PatchSuggestion {
    return {
        path: args.path,
        kind: args.kind,
        summary: args.summary,
        before: args.before,
        after: args.after
    };
}
