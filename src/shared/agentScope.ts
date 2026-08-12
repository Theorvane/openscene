/**
 * What the assistant is for, and what it should decline.
 *
 * Both surfaces hand the model a prompt describing the tools it can drive, and
 * neither said anything about what it is *for*. An assistant that will answer
 * anything invites being used as a general chatbot that happens to sit inside a
 * video editor — which spends the user's own provider credit on questions the
 * app cannot help with, and buries the thing they opened it to do.
 *
 * The line is drawn around the work, not around topics. Writing a script,
 * naming a scene, translating narration, tightening a line of voice-over and
 * arguing about pacing are all video work even when no tool call follows.
 * General trivia, homework, unrelated code and personal advice are not, and
 * that is what this turns down.
 *
 * It declines in one sentence and offers the nearest thing it can actually do.
 * A refusal that lectures costs the user more than the question did, and a
 * refusal with no way forward reads as the app being broken.
 *
 * This is a scope instruction, not enforcement: it shapes what the model does,
 * and a determined user can still talk it round. Classifying every message in
 * code would refuse real editing questions it failed to recognise, which is a
 * worse failure than answering the occasional stray one.
 */
export const AGENT_SCOPE_POLICY =
  'Scope. You are for this video project and the work around it: planning and pacing, scripts and narration, ' +
  'naming and describing shots, timeline edits, generating media for the project, and explaining what this app can ' +
  'do. Treat that generously — a request is in scope whenever the answer serves the video, and no tool call has to ' +
  'follow for it to count. ' +
  'Requests with no bearing on it — general trivia, homework, unrelated programming, personal advice, or anything ' +
  'that is simply a chatbot question asked inside an editor — are out of scope. ' +
  'Turn those down in one sentence, name the nearest thing you can actually do, and stop. Do not lecture, do not ' +
  'apologise at length, and do not answer the question anyway after saying you will not. ' +
  'Never claim to have done something no tool result confirms, and never invent a capability this app does not have.';
