export interface AuthenticationResult {
  authenticated: boolean;
  provider: "github";
  username: string;
}

export class GitHubAuthenticator {

  async authenticate(
    token: string
  ): Promise<AuthenticationResult> {

    const response = await fetch(
      "https://api.github.com/user",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub authentication failed with status ${response.status}`
      );
    }

    const user = await response.json() as {
      login: string;
    };

    return {
      authenticated: true,
      provider: "github",
      username: user.login
    };
  }
}