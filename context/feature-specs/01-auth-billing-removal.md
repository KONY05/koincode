We're going to be removing the whole billing and auth gateways from the project, clerk, and polar will be removed.

we will remove all userId references in the whole project since the app is scoped to a single user and there won't be multiple users to manage.

we still maintain sentry but since there will be no userID we can use to specify a user, we can generate a hashed id based on the user's machine or something unique to delineate between all the users.

## check if done
- requests should not need to go through any auth checks
- we remove the login command, and all related logic
- we remove the billing command, and all related logic
- remove clerk references