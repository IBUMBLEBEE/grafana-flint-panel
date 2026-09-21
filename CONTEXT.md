# Flint AI Visualization

This context defines the language used when AI discusses, proposes, previews, and applies a visualization change for one Grafana Panel.

## Conversation

**Temporary Conversation**:
A bounded sequence of user and assistant messages used while editing one Panel. It may survive a reload in the same browser tab, but it is not durable history.
_Avoid_: Workspace, durable Session, chat archive

**Message**:
An ephemeral user or assistant text turn in a Temporary Conversation.
_Avoid_: Artifact, saved prompt history

**Last Prompt**:
The only user prompt retained in Panel options, overwritten when the proposal generated from that prompt is successfully applied.
_Avoid_: Conversation history, latest draft input

## Visualization change

**Proposal**:
A validated candidate Flint visualization configuration that has not been applied to the Panel.
_Avoid_: Chat response, final configuration, command

**Preview**:
A temporary rendering of a Proposal against current Panel query data that does not change the committed Panel configuration.
_Avoid_: Apply, save

**Apply**:
The explicit human action that writes a successfully previewed Proposal into the target Panel configuration.
_Avoid_: Preview, generate, model decision

**Undo**:
The one-session action that restores the Panel configuration captured immediately before the latest Apply.
_Avoid_: Conversation rollback, durable version history

## Context and authority

**Panel Query Context**:
The evidence binding a visualization to its Dashboard, Panel, query target, business datasource, frame, and field schema.
_Avoid_: User-selected AI data scope, model-owned datasource

**Business Datasource**:
The Grafana datasource already selected by a Panel query and responsible for producing visualization data.
_Avoid_: AI provider

**AI Provider**:
A configured Flint AI datasource that invokes a model but does not provide, select, or query business visualization data.
_Avoid_: Business datasource, model name
