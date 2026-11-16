import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Egen vy med modulen OTidTracking registrerad, lagd under statusraden.
        window?.rootViewController = OTidRootViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Håller webbvyn under klockan och kameran och ovanför hemstrecket. Webbvyn får då sin vanliga bredd och skala
/// (Capacitors `contentInset: "always"` förstorade sidan så att den gick utanför skärmen i sidled).
final class OTidRootViewController: UIViewController {
    private let web = OTidBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        addChild(web)
        web.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web.view)
        NSLayoutConstraint.activate([
            web.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        web.didMove(toParent: self)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
}
