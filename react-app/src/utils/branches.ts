import type { Conversation, ConversationBranch } from '../types';

/** Maximum number of branches stored per conversation. */
const MAX_BRANCHES = 5;

/**
 * Save the current message tail (from `messageIndex` onward) as a new branch
 * on the conversation. Mutates the conversation in-place and returns it.
 *
 * If there are fewer than 2 messages after `messageIndex` (i.e. nothing
 * meaningful to preserve), the conversation is returned unchanged.
 *
 * When the branch limit is exceeded, the oldest branch is dropped.
 */
export function saveBranch(conversation: Conversation, messageIndex: number): Conversation {
  const tail = conversation.messages.slice(messageIndex);

  // Nothing worth branching — need at least the edited user msg + its response
  if (tail.length < 2) return conversation;

  const branch: ConversationBranch = {
    parentMessageIndex: messageIndex,
    messages: tail.map((m) => ({ ...m })), // shallow-clone each message
  };

  if (!conversation.branches) {
    conversation.branches = [];
  }

  conversation.branches.push(branch);

  // Enforce the per-conversation branch limit (drop oldest first)
  while (conversation.branches.length > MAX_BRANCHES) {
    conversation.branches.shift();
  }

  return conversation;
}

/**
 * Restore a previously saved branch by its index. Replaces the conversation
 * messages from `parentMessageIndex` onward with the branch's saved messages
 * and removes the branch from the array.
 *
 * Returns the updated conversation, or the original if the index is invalid.
 */
export function restoreBranch(conversation: Conversation, branchIndex: number): Conversation {
  const branches = conversation.branches;
  if (!branches || branchIndex < 0 || branchIndex >= branches.length) {
    return conversation;
  }

  const branch = branches[branchIndex];

  // Replace everything from parentMessageIndex onward with the branch messages
  conversation.messages = [
    ...conversation.messages.slice(0, branch.parentMessageIndex),
    ...branch.messages.map((m) => ({ ...m })),
  ];

  // Remove the restored branch
  conversation.branches = branches.filter((_, i) => i !== branchIndex);

  return conversation;
}

/**
 * Return the number of branches that originate at a specific message index.
 * Useful for showing a branch indicator in the UI.
 */
export function getBranchCount(conversation: Conversation, messageIndex: number): number {
  if (!conversation.branches) return 0;
  return conversation.branches.filter((b) => b.parentMessageIndex === messageIndex).length;
}
