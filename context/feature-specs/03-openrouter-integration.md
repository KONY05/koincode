i want us to implement openrouter integration to our cli app.

so i want it that users can either input the key through the command like "koincode --openrouter-key xxx" or they can go to /setup which should open another modal to show them 4 options "openrouter key, anthropic key, openAI key, gemini key" and then a input field beside each of them to enter the key. once the user enters the key, it should be saved in the config file. 

so depending on what api key is there we can decide what provider to use as we stated in the context.

we will also need to include more models (we will handle this part later)

on the model file in the shared package we have a pricing object, do we still keep it or remove it?