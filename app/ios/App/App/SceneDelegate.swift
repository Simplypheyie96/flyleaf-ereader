import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = SafeSidesViewController(CAPBridgeViewController())
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

/// In landscape, holds the app inside the side safe areas (the notch). In portrait the app
/// stays full-bleed; a status column down one edge (iPhone Duo) reaches the web as
/// env(safe-area-inset-right), and the web keeps only its top row clear of it.
/// The strips beside the app take the page's own background.
final class SafeSidesViewController: UIViewController {
    private let bridge: CAPBridgeViewController
    private var background: NSKeyValueObservation?
    private var full: [NSLayoutConstraint] = []
    private var safe: [NSLayoutConstraint] = []

    init(_ bridge: CAPBridgeViewController) {
        self.bridge = bridge
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(bridge)
        let app: UIView = bridge.view
        app.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(app)
        NSLayoutConstraint.activate([
            app.topAnchor.constraint(equalTo: view.topAnchor),
            app.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        full = [app.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                app.trailingAnchor.constraint(equalTo: view.trailingAnchor)]
        safe = [app.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
                app.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor)]
        NSLayoutConstraint.activate(full)
        bridge.didMove(toParent: self)
        background = bridge.webView?.observe(\.underPageBackgroundColor, options: [.initial, .new]) { [weak self] webView, _ in
            self?.view.backgroundColor = webView.underPageBackgroundColor
        }
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        let landscape = view.bounds.width > view.bounds.height
        if landscape != safe.first!.isActive {
            NSLayoutConstraint.deactivate(landscape ? full : safe)
            NSLayoutConstraint.activate(landscape ? safe : full)
        }
    }

    override var childForStatusBarStyle: UIViewController? { bridge }
    override var childForStatusBarHidden: UIViewController? { bridge }
    override var childForHomeIndicatorAutoHidden: UIViewController? { bridge }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { bridge.supportedInterfaceOrientations }
}
