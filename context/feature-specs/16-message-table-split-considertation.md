so right now we have the messages data all living on the session table, and i'm not really concerned since it's a since user that has the conversation, but i'm thinking in the future we might want to split this up into a new table, just for more efficient queries and what not.  Thoughts???

cause i want to see if i can add more features like deleting a message and reverting the chat to the message before that (deleting a user message deletes the ai response after that)

and also when we load a all sessions we load messages as well i'm just thinking about efficiency since we'll always be hitting the session table everytime we send a message in the current implementation.

and if i want to implement that subtle feature where by the first text the user sends is passed to a model to get a title for the chat.